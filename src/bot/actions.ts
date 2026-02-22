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
  `).all() as unknown as ActiveRun[];
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
  `).all(limit) as unknown as RecentFailure[];
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
