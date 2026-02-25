# Antfarm Telegram Control Bot — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Grammy-based Telegram bot daemon to Antfarm so David can query run status, control runs, and manage Linear tickets via natural language messages.

**Architecture:** Grammy bot runs as a separate daemon process (same pattern as the dashboard). It reads SQLite directly for status, spawns `antfarm`/`openclaw` CLI commands for control actions, and calls the Linear GraphQL API for ticket management. Claude Haiku parses natural language messages into structured intents. A small HTTP endpoint on port 3334 receives push events from `events.ts` so step failures are delivered proactively.

**Tech Stack:** Grammy (Telegram bot), `@anthropic-ai/sdk` (Haiku intent parser), raw `fetch` for Linear GraphQL, `node:sqlite` via `getDb()`, `node:child_process` for CLI commands, `node:http` for the internal notify endpoint.

---

## Prerequisites (do these manually before starting)

1. **Create a new Telegram bot** via @BotFather — this MUST be a different bot from `@supergeri_openclawbot` (which OpenClaw gateway owns). Running Grammy polling on the same token as OpenClaw's Telegram integration causes a 409 Conflict.
   - Message @BotFather → `/newbot` → name it `Antfarm Control` → get token

2. **Add config to `~/.openclaw/openclaw.json`** under a new `"antfarmBot"` key:
   ```json
   "antfarmBot": {
     "botToken": "<your-new-bot-token>",
     "allowedChatIds": [7888191549],
     "notifyPort": 3334
   }
   ```

3. **Ensure `LINEAR_API_KEY` is set in your shell environment** (check `~/.zshrc` or `~/.zprofile`). The auto-starter.js already uses this.

4. **Message your new bot on Telegram** once to pair (needed for it to be able to send to you).

---

## Task 1: Add npm dependencies

**Files:**
- Modify: `~/.openclaw/workspace/antfarm/package.json`

**Step 1: Add grammy and @anthropic-ai/sdk to dependencies**

Edit `package.json` — change the `"dependencies"` block to:
```json
"dependencies": {
  "grammy": "^1.31.0",
  "@anthropic-ai/sdk": "^0.39.0",
  "json5": "^2.2.3",
  "yaml": "^2.4.5"
}
```

**Step 2: Install**

```bash
cd ~/.openclaw/workspace/antfarm && npm install
```

Expected: grammy and @anthropic-ai/sdk installed in node_modules.

**Step 3: Verify Grammy installed**

```bash
ls ~/.openclaw/workspace/antfarm/node_modules/grammy
```

Expected: directory exists.

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/antfarm
git add package.json package-lock.json
git commit -m "feat: add grammy and anthropic-sdk deps for telegram bot"
```

---

## Task 2: Create bot config reader

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/config.ts`

**Step 1: Write config.ts**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface BotConfig {
  botToken: string;
  allowedChatIds: number[];
  notifyPort: number;
}

export function getBotConfig(): BotConfig {
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch {
    throw new Error(`Cannot read openclaw.json at ${cfgPath}`);
  }
  const bot = raw["antfarmBot"] as Partial<BotConfig> | undefined;
  if (!bot?.botToken) {
    throw new Error('Missing "antfarmBot.botToken" in openclaw.json. Create a bot via @BotFather and add it.');
  }
  return {
    botToken: bot.botToken,
    allowedChatIds: bot.allowedChatIds ?? [],
    notifyPort: bot.notifyPort ?? 3334,
  };
}
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/config.ts
git commit -m "feat: add bot config reader from openclaw.json"
```

---

## Task 3: Create botctl.ts (daemon lifecycle)

This mirrors `src/server/daemonctl.ts` exactly, but for the bot process.

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/botctl.ts`

**Step 1: Write botctl.ts**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getBotPidFile(): string {
  return path.join(os.homedir(), ".openclaw", "antfarm", "bot.pid");
}

export function getBotLogFile(): string {
  return path.join(os.homedir(), ".openclaw", "antfarm", "bot.log");
}

export function isBotRunning(): { running: true; pid: number } | { running: false } {
  const pidFile = getBotPidFile();
  if (!fs.existsSync(pidFile)) return { running: false };
  const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
  if (isNaN(pid)) return { running: false };
  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    try { fs.unlinkSync(pidFile); } catch {}
    return { running: false };
  }
}

export async function startBotDaemon(): Promise<{ pid: number }> {
  const status = isBotRunning();
  if (status.running) return { pid: status.pid };

  const logFile = getBotLogFile();
  const pidDir = path.dirname(getBotPidFile());
  fs.mkdirSync(pidDir, { recursive: true });

  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(logFile, "a");

  const daemonScript = path.resolve(__dirname, "botdaemon.js");
  const child = spawn("node", [daemonScript], {
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();

  await new Promise((r) => setTimeout(r, 1500));

  const check = isBotRunning();
  if (!check.running) {
    throw new Error("Bot daemon failed to start. Check " + logFile);
  }
  return { pid: check.pid };
}

export function stopBotDaemon(): boolean {
  const status = isBotRunning();
  if (!status.running) return false;
  try { process.kill(status.pid, "SIGTERM"); } catch {}
  try { fs.unlinkSync(getBotPidFile()); } catch {}
  return true;
}

export function getBotDaemonStatus(): { running: boolean; pid?: number } {
  const status = isBotRunning();
  if (!status.running) return { running: false };
  return { running: true, pid: status.pid };
}
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/botctl.ts
git commit -m "feat: add bot daemon lifecycle controller (botctl)"
```

---

## Task 4: Create actions.ts (SQLite queries + CLI control)

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/actions.ts`

**Step 1: Write actions.ts**

```typescript
import { execSync } from "node:child_process";
import { getDb } from "../db.js";

export interface ActiveRun {
  id: string;
  run_number: number | null;
  workflow_id: string;
  task: string;
  current_step: string | null;
  current_agent: string | null;
  step_status: string | null;
  updated_at: string;
}

export function getActiveRuns(): ActiveRun[] {
  const db = getDb();
  const runs = db.prepare(`
    SELECT r.id, r.run_number, r.workflow_id, r.task, r.updated_at,
           s.step_id as current_step, s.agent_id as current_agent, s.status as step_status
    FROM runs r
    LEFT JOIN steps s ON s.run_id = r.id AND s.status IN ('pending','running')
    WHERE r.status = 'running'
    ORDER BY r.created_at DESC
  `).all() as ActiveRun[];
  return runs;
}

export interface RecentFailure {
  id: string;
  run_number: number | null;
  task: string;
  status: string;
  updated_at: string;
  last_step: string | null;
  last_error: string | null;
}

export function getRecentFailures(limit = 5): RecentFailure[] {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.run_number, r.task, r.status, r.updated_at,
           s.step_id as last_step, s.output as last_error
    FROM runs r
    LEFT JOIN steps s ON s.run_id = r.id AND s.status = 'failed'
    WHERE r.status IN ('failed', 'cancelled')
    ORDER BY r.updated_at DESC
    LIMIT ?
  `).all(limit) as RecentFailure[];
}

export interface RunDetail {
  id: string;
  run_number: number | null;
  workflow_id: string;
  task: string;
  status: string;
  created_at: string;
  updated_at: string;
  steps: Array<{ step_id: string; agent_id: string; status: string }>;
}

export function getRunDetail(query: string): RunDetail | null {
  const db = getDb();
  // Support run number (#42), UUID prefix, or ticket substring
  let run: Omit<RunDetail, "steps"> | undefined;
  if (/^\d+$/.test(query)) {
    run = db.prepare("SELECT id, run_number, workflow_id, task, status, created_at, updated_at FROM runs WHERE run_number = ?").get(parseInt(query, 10)) as typeof run;
  }
  if (!run) {
    run = db.prepare("SELECT id, run_number, workflow_id, task, status, created_at, updated_at FROM runs WHERE id LIKE ? OR task LIKE ? ORDER BY created_at DESC LIMIT 1").get(`${query}%`, `%${query}%`) as typeof run;
  }
  if (!run) return null;
  const steps = db.prepare("SELECT step_id, agent_id, status FROM steps WHERE run_id = ? ORDER BY step_index ASC").all(run.id) as RunDetail["steps"];
  return { ...run, steps };
}

// Returns run ID or throws
export function startRun(ticketId: string): string {
  const output = execSync(`antfarm workflow run ai-developer "${ticketId}"`, { encoding: "utf-8", timeout: 30000 });
  const match = output.match(/Run: #\d+ \(([a-f0-9-]+)\)/);
  return match?.[1] ?? output.trim();
}

export function cancelRun(query: string): { ok: boolean; message: string } {
  const detail = getRunDetail(query);
  if (!detail) return { ok: false, message: `No run found matching "${query}"` };
  if (!["running"].includes(detail.status)) return { ok: false, message: `Run ${detail.task} is "${detail.status}", not running` };
  try {
    execSync(`antfarm workflow stop ${detail.id}`, { encoding: "utf-8", timeout: 10000 });
    return { ok: true, message: `Cancelled run #${detail.run_number} (${detail.task})` };
  } catch (e) {
    return { ok: false, message: `Failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function retryStep(query: string, stepId: string): { ok: boolean; message: string } {
  const detail = getRunDetail(query);
  if (!detail) return { ok: false, message: `No run found matching "${query}"` };
  const db = getDb();
  const step = db.prepare("SELECT id, step_id FROM steps WHERE run_id = ? AND step_id = ?").get(detail.id, stepId) as { id: string; step_id: string } | undefined;
  if (!step) return { ok: false, message: `No step "${stepId}" found in run for "${query}"` };
  db.prepare("UPDATE steps SET status='pending', retry_count=0, updated_at=datetime('now') WHERE id=?").run(step.id);
  db.prepare("UPDATE runs SET status='running', updated_at=datetime('now') WHERE id=?").run(detail.id);
  return { ok: true, message: `Reset step "${stepId}" to pending for run #${detail.run_number}` };
}

export function kickCrons(): string {
  const output = execSync("openclaw cron list", { encoding: "utf-8", timeout: 15000 });
  const cronIds = output.match(/[a-f0-9]{8,}/g) ?? [];
  const unique = [...new Set(cronIds)].slice(0, 20);
  let kicked = 0;
  for (const id of unique) {
    try {
      execSync(`openclaw cron run ${id}`, { encoding: "utf-8", timeout: 5000 });
      kicked++;
    } catch {}
  }
  return `Kicked ${kicked} cron(s).`;
}
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/actions.ts
git commit -m "feat: add bot actions (SQLite queries + CLI control)"
```

---

## Task 5: Create linear.ts (Linear GraphQL client)

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/linear.ts`

Joshua's Linear user ID (hardcoded — already known): `9f0978e8-76bb-41de-b83d-6773d7c87fd9`

**Step 1: Write linear.ts**

```typescript
const LINEAR_API = "https://api.linear.app/graphql";
const JOSHUA_ID = "9f0978e8-76bb-41de-b83d-6773d7c87fd9";

function getToken(): string {
  const t = process.env.LINEAR_API_KEY;
  if (!t) throw new Error("LINEAR_API_KEY environment variable not set");
  return t;
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const resp = await fetch(LINEAR_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: string };
  priority: number;
  url: string;
}

export async function getBacklogTickets(): Promise<LinearTicket[]> {
  const data = await gql(`
    query {
      issues(
        filter: {
          assignee: { id: { eq: "${JOSHUA_ID}" } }
          state: { type: { in: ["unstarted", "backlog"] } }
        }
        orderBy: priority
        first: 20
      ) {
        nodes { id identifier title url priority state { name type } }
      }
    }
  `) as { issues: { nodes: LinearTicket[] } };
  return data.issues.nodes;
}

export async function getTicket(identifier: string): Promise<LinearTicket | null> {
  const data = await gql(`
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 1) {
        nodes { id identifier title url priority state { name type } }
      }
    }
  `, { filter: { identifier: { eq: identifier } } }) as { issues: { nodes: LinearTicket[] } };
  return data.issues.nodes[0] ?? null;
}

export async function getStates(): Promise<Array<{ id: string; name: string; type: string }>> {
  const data = await gql(`
    query {
      workflowStates(filter: { team: { key: { eq: "AMA" } } }) {
        nodes { id name type }
      }
    }
  `) as { workflowStates: { nodes: Array<{ id: string; name: string; type: string }> } };
  return data.workflowStates.nodes;
}

export async function updateTicketState(identifier: string, stateName: string): Promise<string> {
  const ticket = await getTicket(identifier);
  if (!ticket) throw new Error(`Ticket ${identifier} not found`);
  const states = await getStates();
  const state = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
  if (!state) throw new Error(`State "${stateName}" not found. Available: ${states.map((s) => s.name).join(", ")}`);
  await gql(`
    mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }
  `, { id: ticket.id, stateId: state.id });
  return `${identifier} moved to "${state.name}"`;
}

export async function assignTicket(identifier: string, assigneeName: string): Promise<string> {
  const ticket = await getTicket(identifier);
  if (!ticket) throw new Error(`Ticket ${identifier} not found`);
  // Only supports Joshua for now
  if (!assigneeName.toLowerCase().includes("joshua")) {
    throw new Error(`Only "Joshua" is supported as assignee right now`);
  }
  await gql(`
    mutation($id: String!, $assigneeId: String!) {
      issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
    }
  `, { id: ticket.id, assigneeId: JOSHUA_ID });
  return `${identifier} assigned to Joshua`;
}
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/linear.ts
git commit -m "feat: add linear graphql client for ticket queries and mutations"
```

---

## Task 6: Create bot.ts (Grammy + Claude Haiku router)

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/bot.ts`

**Step 1: Write bot.ts**

```typescript
import { Bot, type Context } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import { getBotConfig } from "./config.js";
import {
  getActiveRuns, getRecentFailures, getRunDetail,
  startRun, cancelRun, retryStep, kickCrons,
} from "./actions.js";
import {
  getBacklogTickets, getTicket, updateTicketState, assignTicket,
} from "./linear.js";

const INTENT_SYSTEM = `You are an intent classifier for the Antfarm CI/CD control bot.
Classify the user message into one of these intents and extract parameters as JSON.

Intents:
- status_all         — "what's running?", "show runs", "status"
- status_run         — "status of AMA-123" → { query: "AMA-123" }
- failed_recent      — "what failed?", "recent failures"
- start_run          — "start AMA-456" → { ticket: "AMA-456" }
- cancel_run         — "cancel AMA-123" → { query: "AMA-123" }
- retry_step         — "retry develop for AMA-123" → { query: "AMA-123", step: "develop" }
- kick_crons         — "kick crons", "restart crons"
- linear_backlog     — "what's in backlog?", "show backlog"
- linear_ticket      — "info on AMA-123" → { ticket: "AMA-123" }
- linear_move        — "move AMA-123 to in progress" → { ticket: "AMA-123", state: "In Progress" }
- linear_assign      — "assign AMA-789 to Joshua" → { ticket: "AMA-789", assignee: "Joshua" }
- unknown            — anything else

Respond with ONLY valid JSON: { "intent": "...", "params": { ... } }`;

interface IntentResult {
  intent: string;
  params: Record<string, string>;
}

const anthropic = new Anthropic();

async function classifyIntent(text: string): Promise<IntentResult> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      system: INTENT_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const content = msg.content[0];
    if (content.type !== "text") return { intent: "unknown", params: {} };
    return JSON.parse(content.text) as IntentResult;
  } catch {
    return { intent: "unknown", params: {} };
  }
}

function formatActiveRuns(): string {
  const runs = getActiveRuns();
  if (runs.length === 0) return "No active runs.";
  const lines = runs.map((r) => {
    const num = r.run_number != null ? `#${r.run_number}` : r.id.slice(0, 8);
    const ticket = r.task.match(/AMA-\d+/)?.[0] ?? r.task.slice(0, 30);
    const step = r.current_step ?? "unknown step";
    const agent = r.current_agent ?? "";
    const mins = Math.round((Date.now() - new Date(r.updated_at).getTime()) / 60000);
    return `${num} ${ticket}: ${step} ${agent ? `(${agent})` : ""} — ${mins}m ago`;
  });
  return `Active runs (${runs.length}):\n${lines.join("\n")}`;
}

function formatRunDetail(query: string): string {
  const detail = getRunDetail(query);
  if (!detail) return `No run found matching "${query}"`;
  const num = detail.run_number != null ? `#${detail.run_number}` : detail.id.slice(0, 8);
  const steps = detail.steps.map((s) => `  [${s.status.padEnd(7)}] ${s.step_id}`).join("\n");
  return `Run ${num}: ${detail.task}\nStatus: ${detail.status}\n\nSteps:\n${steps}`;
}

function formatBacklog(tickets: Awaited<ReturnType<typeof getBacklogTickets>>): string {
  if (tickets.length === 0) return "No backlog tickets.";
  const lines = tickets.map((t) => `${t.identifier}: ${t.title} (${t.state.name})`);
  return `Backlog (${tickets.length}):\n${lines.join("\n")}`;
}

export async function handleMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const { intent, params } = await classifyIntent(text);

  try {
    switch (intent) {
      case "status_all":
        await ctx.reply(formatActiveRuns());
        break;

      case "status_run":
        await ctx.reply(formatRunDetail(params.query ?? ""));
        break;

      case "failed_recent": {
        const failures = getRecentFailures(5);
        if (failures.length === 0) { await ctx.reply("No recent failures."); break; }
        const lines = failures.map((f) => {
          const num = f.run_number != null ? `#${f.run_number}` : f.id.slice(0, 8);
          return `${num} ${f.task.slice(0, 40)} — ${f.status} at ${f.last_step ?? "?"}`;
        });
        await ctx.reply(`Recent failures:\n${lines.join("\n")}`);
        break;
      }

      case "start_run": {
        const ticket = params.ticket;
        if (!ticket) { await ctx.reply("Which ticket? e.g. start AMA-123"); break; }
        await ctx.reply(`Starting ${ticket}...`);
        const runId = startRun(ticket);
        await ctx.reply(`Started! Run ID: ${runId.slice(0, 8)}\nUse: status of ${ticket}`);
        break;
      }

      case "cancel_run": {
        const result = cancelRun(params.query ?? "");
        await ctx.reply(result.ok ? result.message : `Failed: ${result.message}`);
        break;
      }

      case "retry_step": {
        const result = retryStep(params.query ?? "", params.step ?? "");
        await ctx.reply(result.ok ? result.message : `Failed: ${result.message}`);
        break;
      }

      case "kick_crons": {
        await ctx.reply("Kicking crons...");
        const msg = kickCrons();
        await ctx.reply(msg);
        break;
      }

      case "linear_backlog": {
        const tickets = await getBacklogTickets();
        await ctx.reply(formatBacklog(tickets));
        break;
      }

      case "linear_ticket": {
        const t = await getTicket(params.ticket ?? "");
        if (!t) { await ctx.reply(`Ticket ${params.ticket} not found.`); break; }
        await ctx.reply(`${t.identifier}: ${t.title}\nState: ${t.state.name}\n${t.url}`);
        break;
      }

      case "linear_move": {
        const msg = await updateTicketState(params.ticket ?? "", params.state ?? "");
        await ctx.reply(msg);
        break;
      }

      case "linear_assign": {
        const msg = await assignTicket(params.ticket ?? "", params.assignee ?? "");
        await ctx.reply(msg);
        break;
      }

      default:
        await ctx.reply(
          "I can help with:\n" +
          "• what's running?\n• status of AMA-123\n• what failed?\n" +
          "• start AMA-456\n• cancel AMA-123\n• retry develop for AMA-123\n" +
          "• kick crons\n• what's in backlog?\n• move AMA-123 to in progress"
        );
    }
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createBot(token: string, allowedChatIds: number[]): Bot {
  const bot = new Bot(token);

  // Allowlist guard
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !allowedChatIds.includes(chatId)) {
      // Silently ignore unknown chats
      return;
    }
    await next();
  });

  bot.on("message:text", handleMessage);

  bot.catch((err) => {
    console.error("[bot] Error:", err.message);
  });

  return bot;
}
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/bot.ts
git commit -m "feat: add grammy bot with claude haiku intent router"
```

---

## Task 7: Create botdaemon.ts (the spawned entry point)

This is what `botctl.ts` actually spawns as a detached process. It starts Grammy polling AND the HTTP notify endpoint.

**Files:**
- Create: `~/.openclaw/workspace/antfarm/src/bot/botdaemon.ts`

**Step 1: Write botdaemon.ts**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { getBotConfig } from "./config.js";
import { createBot } from "./bot.js";
import type { AntfarmEvent } from "../installer/events.js";

// Write PID file
const pidFile = path.join(os.homedir(), ".openclaw", "antfarm", "bot.pid");
fs.writeFileSync(pidFile, String(process.pid));

// Cleanup on exit
process.on("SIGTERM", () => {
  try { fs.unlinkSync(pidFile); } catch {}
  process.exit(0);
});

async function main() {
  const cfg = getBotConfig();

  // Start Grammy bot
  const bot = createBot(cfg.botToken, cfg.allowedChatIds);
  bot.start({ drop_pending_updates: true });
  console.log(`[bot] Grammy polling started (PID ${process.pid})`);

  // HTTP notify endpoint — receives events from events.ts
  // POST /notify with AntfarmEvent JSON body
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/notify") {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      res.writeHead(200);
      res.end("ok");
      try {
        const evt = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as AntfarmEvent;
        // Only push failures and completions
        if (evt.event === "step.failed" || evt.event === "run.failed") {
          const ticket = evt.detail?.match(/AMA-\d+/)?.[0] ?? evt.runId.slice(0, 8);
          const step = evt.stepId ?? "unknown";
          const msg = `FAILED: ${ticket} at step "${step}"\n${evt.detail ?? ""}`.trim();
          for (const chatId of cfg.allowedChatIds) {
            await bot.api.sendMessage(chatId, msg).catch(() => {});
          }
        }
        if (evt.event === "run.completed") {
          const ticket = evt.detail?.match(/AMA-\d+/)?.[0] ?? evt.runId.slice(0, 8);
          for (const chatId of cfg.allowedChatIds) {
            await bot.api.sendMessage(chatId, `DONE: ${ticket} completed`).catch(() => {});
          }
        }
      } catch {}
    });
  });

  server.listen(cfg.notifyPort, "127.0.0.1", () => {
    console.log(`[bot] Notify endpoint listening on 127.0.0.1:${cfg.notifyPort}`);
  });
}

main().catch((err) => {
  console.error("[bot] Fatal:", err);
  process.exit(1);
});
```

**Step 2: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/bot/botdaemon.ts
git commit -m "feat: add bot daemon entry point (grammy + http notify endpoint)"
```

---

## Task 8: Extend events.ts to push failures to bot

**Files:**
- Modify: `~/.openclaw/workspace/antfarm/src/installer/events.ts`

**Step 1: Read current events.ts** (already read — 118 lines, see context above)

**Step 2: Add `fireBotNotify()` function after the existing `fireWebhook()` function**

Add this function after line ~95 (after `fireWebhook`):

```typescript
function fireBotNotify(evt: AntfarmEvent): void {
  // Only fire for failure/completion events
  const notifiableEvents: EventType[] = ["step.failed", "run.failed", "run.completed"];
  if (!notifiableEvents.includes(evt.event)) return;

  // Read notifyPort from config (best-effort)
  let port = 3334;
  try {
    const cfgPath = `${process.env.HOME}/.openclaw/openclaw.json`;
    const raw = JSON.parse(require("node:fs").readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    const botCfg = raw["antfarmBot"] as { notifyPort?: number } | undefined;
    if (botCfg?.notifyPort) port = botCfg.notifyPort;
  } catch {}

  fetch(`http://127.0.0.1:${port}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evt),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {}); // best-effort, never throw
}
```

**Step 3: Call `fireBotNotify()` from `emitEvent()`**

In the existing `emitEvent()` function, add a call to `fireBotNotify(evt)` after the `fireWebhook(evt)` call:

```typescript
export function emitEvent(evt: AntfarmEvent): void {
  // ... existing file write code ...
  fireWebhook(evt);
  fireBotNotify(evt);  // <-- add this line
}
```

**Step 4: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors. If there are type errors with `require`, replace it with dynamic import or use the `fs` already imported at the top of events.ts.

**Step 5: Commit**

```bash
git add src/installer/events.ts
git commit -m "feat: push step/run failures to bot notify endpoint"
```

---

## Task 9: Add `antfarm bot` CLI commands

**Files:**
- Modify: `~/.openclaw/workspace/antfarm/src/cli/cli.ts`

**Step 1: Add bot import** at the top of cli.ts (after the existing imports):

```typescript
import { startBotDaemon, stopBotDaemon, getBotDaemonStatus, isBotRunning } from "../bot/botctl.js";
```

**Step 2: Add bot group handler** — insert this block before the `if (args.length < 2)` check near the bottom:

```typescript
if (group === "bot") {
  if (action === "stop") {
    if (stopBotDaemon()) {
      console.log("Bot stopped.");
    } else {
      console.log("Bot is not running.");
    }
    return;
  }

  if (action === "status") {
    const st = getBotDaemonStatus();
    if (st.running) {
      console.log(`Bot running (PID ${st.pid ?? "unknown"})`);
    } else {
      console.log("Bot is not running.");
    }
    return;
  }

  // start (explicit or default)
  if (isBotRunning().running) {
    const status = getBotDaemonStatus();
    console.log(`Bot already running (PID ${status.pid})`);
    return;
  }
  try {
    const result = await startBotDaemon();
    console.log(`Bot started (PID ${result.pid})`);
  } catch (err) {
    process.stderr.write(`Failed to start bot: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  return;
}
```

**Step 3: Add bot to printUsage()**

Add these lines to the `printUsage()` function (after the dashboard section):

```
"antfarm bot [start]                 Start Telegram control bot daemon",
"antfarm bot stop                     Stop Telegram control bot",
"antfarm bot status                   Check bot daemon status",
```

**Step 4: Compile check**

```bash
cd ~/.openclaw/workspace/antfarm && npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/cli/cli.ts
git commit -m "feat: add antfarm bot start/stop/status CLI commands"
```

---

## Task 10: Build

**Step 1: Build**

```bash
cd ~/.openclaw/workspace/antfarm && npm run build
```

Expected: TypeScript compiles without errors. `dist/bot/` directory appears with compiled JS files.

**Step 2: Verify compiled output**

```bash
ls ~/.openclaw/workspace/antfarm/dist/bot/
```

Expected: `bot.js  botctl.js  botdaemon.js  botdaemon.js  config.js  actions.js  linear.ts`

**Step 3: Commit build artifacts (dist)**

```bash
cd ~/.openclaw/workspace/antfarm
git add dist/
git commit -m "build: compile telegram bot to dist/"
```

---

## Task 11: Manual smoke test

**Step 1: Start the bot**

```bash
antfarm bot start
```

Expected: `Bot started (PID XXXXX)`

**Step 2: Verify it's running**

```bash
antfarm bot status
```

Expected: `Bot running (PID XXXXX)`

**Step 3: Check logs**

```bash
tail -20 ~/.openclaw/antfarm/bot.log
```

Expected: `[bot] Grammy polling started` and `[bot] Notify endpoint listening on 127.0.0.1:3334`

**Step 4: Send a test message in Telegram**

From David's Telegram, message the new bot: `what's running?`

Expected: Bot replies with active runs (or "No active runs.")

**Step 5: Test status query**

Send: `what failed recently?`

Expected: Bot replies with recent failures or "No recent failures."

**Step 6: Test Linear**

Send: `what's in backlog?`

Expected: Bot replies with backlog ticket list.

**Step 7: Stop the bot**

```bash
antfarm bot stop
```

Expected: `Bot stopped.`

**Step 8: Copy to installed workflows location**

The compiled files need to be in the installed dist as well:

```bash
cp -r ~/.openclaw/workspace/antfarm/dist ~/.openclaw/antfarm/dist
```

Wait — check if antfarm runs from workspace dist or installed dist:
```bash
which antfarm
```
If it points to `~/.openclaw/workspace/antfarm/dist/cli/cli.js`, you're already running the workspace version and this step is unnecessary. If it points elsewhere, copy dist over.

---

## Task 12: Wire bot into `antfarm install` auto-start (optional)

If you want the bot to start automatically when Antfarm installs:

**Files:**
- Modify: `~/.openclaw/workspace/antfarm/src/cli/cli.ts`

**Step 1: In the `install` group handler**, after the dashboard auto-start block, add:

```typescript
// Auto-start bot if configured
try {
  const { getBotConfig } = await import("../bot/config.js");
  getBotConfig(); // throws if not configured
  if (!isBotRunning().running) {
    const botResult = await startBotDaemon();
    console.log(`\nTelegram bot started (PID ${botResult.pid})`);
  }
} catch {
  // Bot not configured — skip silently
}
```

**Step 2: Build and commit**

```bash
cd ~/.openclaw/workspace/antfarm
npm run build
git add src/cli/cli.ts dist/
git commit -m "feat: auto-start telegram bot on antfarm install if configured"
```

---

## Notes for the implementer

- **Grammy long polling vs OpenClaw**: The new bot uses a DIFFERENT token from `@supergeri_openclawbot`. Never use the same token — causes 409 Conflict.
- **`fireBotNotify` in events.ts**: Uses `fs` already imported at top of that file — don't add a second import or `require`. Use the existing `fs` reference.
- **Node 22+**: All imports use ESM (`import.meta.url`, not `__dirname`) unless polyfilled.
- **Linear API key**: Must be set as `LINEAR_API_KEY` env var. Check auto-starter.js if unsure where it's already set.
- **The `dist/bot/botdaemon.js` path**: `botctl.ts` uses `path.resolve(__dirname, "botdaemon.js")`. After build, `__dirname` in `dist/bot/botctl.js` resolves to `dist/bot/`, so `botdaemon.js` must be at `dist/bot/botdaemon.js`. The build puts it there automatically.
