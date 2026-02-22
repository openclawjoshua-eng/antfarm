import { Bot, BotError, type Context } from "grammy";
import {
  getActiveRuns, getRecentFailures, getRunDetail,
  startRun, cancelRun, retryStep, kickCrons,
  type ActiveRun,
} from "./actions.js";
import {
  getBacklogTickets, getTicket, updateTicketState, assignTicket,
} from "./linear.js";

interface IntentResult {
  intent: string;
  params: Record<string, string>;
}

function classifyIntent(text: string): IntentResult {
  const t = text.toLowerCase().trim();
  const ticketMatch = text.match(/\b([A-Z]+-\d+)\b/);
  const ticket = ticketMatch?.[1] ?? "";

  // kick crons
  if (/kick.+cron|restart.+cron|cron.+kick/.test(t)) {
    return { intent: "kick_crons", params: {} };
  }

  // retry step: "retry develop for AMA-123" or "retry AMA-123 develop"
  const retryMatch1 = t.match(/retry\s+(\w+)\s+(?:for\s+)?([a-z]+-\d+)/i);
  const retryMatch2 = !retryMatch1 ? t.match(/retry\s+([a-z]+-\d+)\s+(\w+)/i) : null;
  const retryMatch = retryMatch1 ?? retryMatch2;
  if (retryMatch) {
    const g1 = retryMatch[1], g2 = retryMatch[2];
    const isTicket1 = /^[a-z]+-\d+$/i.test(g1);
    return { intent: "retry_step", params: { query: (isTicket1 ? g1 : g2).toUpperCase(), step: isTicket1 ? g2 : g1 } };
  }

  // move ticket state: "move AMA-123 to in progress"
  const moveMatch = text.match(/move\s+([A-Z]+-\d+)\s+to\s+(.+)/i);
  if (moveMatch) {
    return { intent: "linear_move", params: { ticket: moveMatch[1].toUpperCase(), state: moveMatch[2].trim() } };
  }

  // assign ticket: "assign AMA-789 to Joshua"
  const assignMatch = text.match(/assign\s+([A-Z]+-\d+)\s+to\s+(\w+)/i);
  if (assignMatch) {
    return { intent: "linear_assign", params: { ticket: assignMatch[1].toUpperCase(), assignee: assignMatch[2] } };
  }

  // start run
  if (/\bstart\b/.test(t) && ticket) {
    return { intent: "start_run", params: { ticket } };
  }

  // cancel/stop run
  if (/\b(cancel|stop)\b/.test(t) && ticket) {
    return { intent: "cancel_run", params: { query: ticket } };
  }

  // status of specific ticket/run
  if (ticket && /status|how is|what.?s happening|progress/.test(t)) {
    return { intent: "status_run", params: { query: ticket } };
  }
  // bare ticket ID
  if (ticket && t.replace(/\s/g, "") === ticket.toLowerCase()) {
    return { intent: "status_run", params: { query: ticket } };
  }

  // failed/failures
  if (/fail|what failed|recent failure/.test(t)) {
    return { intent: "failed_recent", params: {} };
  }

  // backlog
  if (/backlog|unstarted|what.?s next|show ticket/.test(t)) {
    return { intent: "linear_backlog", params: {} };
  }

  // linear ticket info
  if (ticket && /info|detail|about|what is|tell me/.test(t)) {
    return { intent: "linear_ticket", params: { ticket } };
  }

  // status all: "what's running", "show runs", "status"
  if (/running|what.?s running|show runs|^status$/.test(t)) {
    return { intent: "status_all", params: {} };
  }

  return { intent: "unknown", params: {} };
}

function formatActiveRuns(runs: ActiveRun[]): string {
  if (runs.length === 0) return "No active runs.";
  const lines = runs.map((r) => {
    const num = r.run_number != null ? `#${r.run_number}` : r.id.slice(0, 8);
    const ticket = r.task.match(/AMA-\d+/)?.[0] ?? r.task.slice(0, 30);
    const step = r.current_step ?? "unknown step";
    const agent = r.current_agent ?? "";
    const mins = Math.round((Date.now() - new Date(r.updated_at).getTime()) / 60000);
    return `${num} ${ticket}: ${step}${agent ? ` (${agent})` : ""} — ${mins}m ago`;
  });
  return `Active runs (${runs.length}):\n${lines.join("\n")}`;
}

export async function handleMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const { intent, params } = classifyIntent(text);

  try {
    switch (intent) {
      case "status_all":
        await ctx.reply(formatActiveRuns(getActiveRuns()));
        break;

      case "status_run": {
        const detail = getRunDetail(params.query ?? "");
        if (!detail) { await ctx.reply(`No run found matching "${params.query}"`); break; }
        const num = detail.run_number != null ? `#${detail.run_number}` : detail.id.slice(0, 8);
        const steps = detail.steps.map((s) => `  [${s.status.padEnd(7)}] ${s.step_id}`).join("\n");
        await ctx.reply(`Run ${num}: ${detail.task}\nStatus: ${detail.status}\n\nSteps:\n${steps}`);
        break;
      }

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
        if (tickets.length === 0) { await ctx.reply("No backlog tickets."); break; }
        const lines = tickets.map((t) => `${t.identifier}: ${t.title} (${t.state.name})`);
        await ctx.reply(`Backlog (${tickets.length}):\n${lines.join("\n")}`);
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

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !allowedChatIds.includes(chatId)) {
      return; // silently ignore unknown chats
    }
    await next();
  });

  bot.on("message:text", handleMessage);

  bot.catch((err: BotError) => {
    console.error("[bot] Error:", err.message);
  });

  return bot;
}
