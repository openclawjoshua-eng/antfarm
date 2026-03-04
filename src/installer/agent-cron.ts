import { createAgentCronJob, deleteAgentCronJobs, listCronJobs, checkCronToolAvailable } from "./gateway-api.js";
import type { WorkflowSpec } from "./types.js";
import { resolveAntfarmCli } from "./paths.js";
import { getDb } from "../db.js";
import { readOpenClawConfig } from "./openclaw-config.js";

const DEFAULT_EVERY_MS = 300_000; // 5 minutes
const DEFAULT_POLLING_TIMEOUT_SECONDS = 120; // 2 minutes (Phase 1 is lightweight)
const DEFAULT_DIRECT_TIMEOUT_SECONDS = 1800; // 30 minutes (single-phase: claim + work)
const DEFAULT_POLLING_MODEL = "moonshot/kimi-k2.5";

// ── Phase 2: Work execution prompt (spawned as subagent) ──────────
function buildWorkPrompt(workflowId: string, agentId: string): string {
  const fullAgentId = `${workflowId}_${agentId}`;
  const cli = resolveAntfarmCli();

  return `You are an Antfarm workflow agent. Execute the pending work below.

⚠️ CRITICAL: You MUST call "step complete" or "step fail" before ending your session. If you don't, the workflow will be stuck forever. This is non-negotiable.

The claimed step JSON is at the END of this message. It contains: {"stepId": "...", "runId": "...", "input": "..."}
Save the stepId — you'll need it to report completion.
The "input" field contains your FULLY RESOLVED task instructions. Read it carefully and DO the work.

Do the work described in the input. Format your output with KEY: value lines as specified.

MANDATORY: Report completion (do this IMMEDIATELY after finishing the work):
\`\`\`
node ${cli} step complete "<stepId>" <<'ANTFARM_EOF'
STATUS: done
CHANGES: what you did
TESTS: what tests you ran
ANTFARM_EOF
\`\`\`

If the work FAILED:
\`\`\`
node ${cli} step fail "<stepId>" "description of what went wrong"
\`\`\`

RULES:
1. NEVER end your session without calling step complete or step fail
2. Pipe output via heredoc to stdin (do NOT write to files — you may not have write permission)
3. If you're unsure whether to complete or fail, call step fail with an explanation

The workflow cannot advance until you report. Your session ending without reporting = broken pipeline.`;
}

function extractModel(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const primary = (value as { primary?: unknown }).primary;
    if (typeof primary === "string") return primary;
  }
  return undefined;
}

async function resolveAgentCronModel(agentId: string, requestedModel?: string): Promise<string | undefined> {
  if (requestedModel && requestedModel !== "default") {
    return requestedModel;
  }

  try {
    const { config } = await readOpenClawConfig();
    const agents = config.agents?.list;
    if (Array.isArray(agents)) {
      const entry = agents.find((a: any) => a?.id === agentId);
      const configured = extractModel(entry?.model);
      if (configured) return configured;
    }

    const defaults = config.agents?.defaults;
    const fallback = extractModel(defaults?.model);
    if (fallback) return fallback;
  } catch {
    // best-effort — fallback below
  }

  return requestedModel;
}

// ── Phase 1: Lightweight polling prompt (cheap model) ─────────────
export function buildPollingPrompt(workflowId: string, agentId: string, workModel?: string): string {
  const fullAgentId = `${workflowId}_${agentId}`;
  const cli = resolveAntfarmCli();
  const model = workModel ?? "anthropic/claude-haiku-4-5-20251001";
  const workPrompt = buildWorkPrompt(workflowId, agentId);

  return `Check for pending work. Run this command:
\`\`\`
node ${cli} step claim "${fullAgentId}"
\`\`\`
If output is "NO_WORK", reply HEARTBEAT_OK and stop immediately.

If JSON is returned, you MUST spawn a worker session to handle it. Parse the JSON to confirm it has stepId, runId, and input fields.

Then call the sessions_spawn tool with these EXACT parameters:
- agentId: "${fullAgentId}"
- model: "${model}"
- task: The full work prompt below (between the START/END markers), followed by two newlines, then "CLAIMED STEP JSON:" on its own line, then the EXACT JSON output from step claim.

---START WORK PROMPT---
${workPrompt}
---END WORK PROMPT---

After spawning, reply with a short summary of what you dispatched (e.g. "Spawned worker for step <stepId>"). Do NOT attempt to do the work yourself.`;
}

// ── Single-phase: Direct claim + work in one session ─────────────
// Used when the agent's work model is the same as the polling model
// (e.g. Haiku agents like closer, auditor, picker). No spawning needed.
function buildDirectPrompt(workflowId: string, agentId: string): string {
  const fullAgentId = `${workflowId}_${agentId}`;
  const cli = resolveAntfarmCli();

  return `You are an Antfarm workflow agent. Check for work and execute it directly.

Step 1: Check for pending work:
\`\`\`
node ${cli} step claim "${fullAgentId}"
\`\`\`
If output is "NO_WORK", reply HEARTBEAT_OK and stop immediately. Do NOTHING else.

Step 2: If JSON is returned, it contains {"stepId": "...", "runId": "...", "input": "..."}.
Save the stepId. Read the "input" field — it contains your task instructions. Do the work.

Step 3: Report completion (MANDATORY — do this IMMEDIATELY after finishing):
\`\`\`
node ${cli} step complete "<stepId>" <<'ANTFARM_EOF'
STATUS: done
CHANGES: what you did
ANTFARM_EOF
\`\`\`

If the work FAILED:
\`\`\`
node ${cli} step fail "<stepId>" "description of what went wrong"
\`\`\`

RULES:
1. NEVER end your session without calling step complete or step fail (unless NO_WORK)
2. Pipe output via heredoc to stdin
3. If unsure whether to complete or fail, call step fail with an explanation
4. The workflow CANNOT advance until you report. Ending without reporting = broken pipeline.`;
}

export async function setupAgentCrons(workflow: WorkflowSpec): Promise<void> {
  const agents = workflow.agents;
  // Allow per-workflow cron interval via cron.interval_ms in workflow.yml
  const everyMs = (workflow as any).cron?.interval_ms ?? DEFAULT_EVERY_MS;

  // Two-phase polling: Phase 1 uses cheap model + short timeout
  const workflowPollingModel = workflow.polling?.model ?? DEFAULT_POLLING_MODEL;
  const workflowPollingTimeout = workflow.polling?.timeoutSeconds ?? DEFAULT_POLLING_TIMEOUT_SECONDS;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const numCrons = (agent as any).num_crons ?? 1;

    const pollingModel = agent.pollingModel ?? workflowPollingModel;
    const workModel = agent.model;

    // If work model == polling model, use single-phase (direct) mode.
    // No point spawning a subagent with the same model — just do the work.
    const useDirectMode = workModel === pollingModel;
    const prompt = useDirectMode
      ? buildDirectPrompt(workflow.id, agent.id)
      : buildPollingPrompt(workflow.id, agent.id, workModel);
    const timeoutSeconds = useDirectMode
      ? ((workflow as any).cron?.timeout_seconds ?? DEFAULT_DIRECT_TIMEOUT_SECONDS)
      : workflowPollingTimeout;

    for (let j = 0; j < numCrons; j++) {
      const cronSuffix = numCrons > 1 ? `/${j + 1}` : '';
      const cronName = `antfarm/${workflow.id}/${agent.id}${cronSuffix}`;
      const agentId = `${workflow.id}_${agent.id}`;
      // Stagger: 1 min per agent, then spread multiple crons evenly within interval
      const anchorMs = i * 60_000 + j * Math.floor(everyMs / numCrons);

      const result = await createAgentCronJob({
        name: cronName,
        schedule: { kind: "every", everyMs, anchorMs },
        sessionTarget: "isolated",
        agentId,
        payload: { kind: "agentTurn", message: prompt, model: pollingModel, timeoutSeconds },
        delivery: { mode: "none" },
        enabled: true,
      });

      if (!result.ok) {
        throw new Error(`Failed to create cron job for agent "${agent.id}" (${j + 1}/${numCrons}): ${result.error}`);
      }
    }
  }
}

export async function removeAgentCrons(workflowId: string): Promise<void> {
  await deleteAgentCronJobs(`antfarm/${workflowId}/`);
}

// ── Run-scoped cron lifecycle ───────────────────────────────────────

/**
 * Count active (running) runs for a given workflow.
 */
function countActiveRuns(workflowId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE workflow_id = ? AND status = 'running'"
  ).get(workflowId) as { cnt: number };
  return row.cnt;
}

/**
 * Check if crons already exist for a workflow.
 */
async function workflowCronsExist(workflowId: string): Promise<boolean> {
  const result = await listCronJobs();
  if (!result.ok || !result.jobs) return false;
  const prefix = `antfarm/${workflowId}/`;
  return result.jobs.some((j) => j.name.startsWith(prefix));
}

/**
 * Start crons for a workflow when a run begins.
 * No-ops if crons already exist (another run of the same workflow is active).
 */
export async function ensureWorkflowCrons(workflow: WorkflowSpec): Promise<void> {
  if (await workflowCronsExist(workflow.id)) return;

  // Preflight: verify cron tool is accessible before attempting to create jobs
  const preflight = await checkCronToolAvailable();
  if (!preflight.ok) {
    throw new Error(preflight.error!);
  }

  await setupAgentCrons(workflow);
}

/**
 * Tear down crons for a workflow when a run ends.
 * Only removes if no other active runs exist for this workflow.
 */
export async function teardownWorkflowCronsIfIdle(workflowId: string): Promise<void> {
  const active = countActiveRuns(workflowId);
  if (active > 0) return;
  await removeAgentCrons(workflowId);
}
