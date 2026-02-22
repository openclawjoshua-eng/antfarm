import { Bot } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveRuns, getRecentFailures, getRunDetail, startRun, cancelRun, retryStep, kickCrons, } from "./actions.js";
import { getBacklogTickets, getTicket, updateTicketState, assignTicket, } from "./linear.js";
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
const anthropic = new Anthropic();
async function classifyIntent(text) {
    try {
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 128,
            system: INTENT_SYSTEM,
            messages: [{ role: "user", content: text }],
        });
        const content = msg.content[0];
        if (content.type !== "text")
            return { intent: "unknown", params: {} };
        return JSON.parse(content.text);
    }
    catch {
        return { intent: "unknown", params: {} };
    }
}
function formatActiveRuns(runs) {
    if (runs.length === 0)
        return "No active runs.";
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
export async function handleMessage(ctx) {
    const text = ctx.message?.text;
    if (!text)
        return;
    const { intent, params } = await classifyIntent(text);
    try {
        switch (intent) {
            case "status_all":
                await ctx.reply(formatActiveRuns(getActiveRuns()));
                break;
            case "status_run": {
                const detail = getRunDetail(params.query ?? "");
                if (!detail) {
                    await ctx.reply(`No run found matching "${params.query}"`);
                    break;
                }
                const num = detail.run_number != null ? `#${detail.run_number}` : detail.id.slice(0, 8);
                const steps = detail.steps.map((s) => `  [${s.status.padEnd(7)}] ${s.step_id}`).join("\n");
                await ctx.reply(`Run ${num}: ${detail.task}\nStatus: ${detail.status}\n\nSteps:\n${steps}`);
                break;
            }
            case "failed_recent": {
                const failures = getRecentFailures(5);
                if (failures.length === 0) {
                    await ctx.reply("No recent failures.");
                    break;
                }
                const lines = failures.map((f) => {
                    const num = f.run_number != null ? `#${f.run_number}` : f.id.slice(0, 8);
                    return `${num} ${f.task.slice(0, 40)} — ${f.status} at ${f.last_step ?? "?"}`;
                });
                await ctx.reply(`Recent failures:\n${lines.join("\n")}`);
                break;
            }
            case "start_run": {
                const ticket = params.ticket;
                if (!ticket) {
                    await ctx.reply("Which ticket? e.g. start AMA-123");
                    break;
                }
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
                if (tickets.length === 0) {
                    await ctx.reply("No backlog tickets.");
                    break;
                }
                const lines = tickets.map((t) => `${t.identifier}: ${t.title} (${t.state.name})`);
                await ctx.reply(`Backlog (${tickets.length}):\n${lines.join("\n")}`);
                break;
            }
            case "linear_ticket": {
                const t = await getTicket(params.ticket ?? "");
                if (!t) {
                    await ctx.reply(`Ticket ${params.ticket} not found.`);
                    break;
                }
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
                await ctx.reply("I can help with:\n" +
                    "• what's running?\n• status of AMA-123\n• what failed?\n" +
                    "• start AMA-456\n• cancel AMA-123\n• retry develop for AMA-123\n" +
                    "• kick crons\n• what's in backlog?\n• move AMA-123 to in progress");
        }
    }
    catch (err) {
        await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export function createBot(token, allowedChatIds) {
    const bot = new Bot(token);
    bot.use(async (ctx, next) => {
        const chatId = ctx.chat?.id;
        if (chatId === undefined || !allowedChatIds.includes(chatId)) {
            return; // silently ignore unknown chats
        }
        await next();
    });
    bot.on("message:text", handleMessage);
    bot.catch((err) => {
        console.error("[bot] Error:", err.message);
    });
    return bot;
}
