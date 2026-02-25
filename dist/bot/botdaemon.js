import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { getBotConfig } from "./config.js";
import { createBot } from "./bot.js";
// Write PID file immediately
const pidFile = path.join(os.homedir(), ".openclaw", "antfarm", "bot.pid");
fs.writeFileSync(pidFile, String(process.pid));
async function main() {
    const cfg = getBotConfig();
    // Start Grammy bot with long polling
    const bot = createBot(cfg.botToken, cfg.allowedChatIds);
    // Graceful shutdown — registered here so bot.stop() is in scope
    const shutdown = async () => {
        try {
            fs.unlinkSync(pidFile);
        }
        catch { }
        await bot.stop().catch(() => { });
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
    void bot.start({ drop_pending_updates: true });
    console.log(`[bot] Grammy polling started (PID ${process.pid})`);
    // HTTP notify endpoint — receives AntfarmEvent POSTs from events.ts
    const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/notify") {
            res.writeHead(404);
            res.end();
            return;
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            res.writeHead(200);
            res.end("ok");
            try {
                const evt = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
                if (evt.event === "step.failed" || evt.event === "run.failed") {
                    const ticket = evt.detail?.match(/AMA-\d+/)?.[0] ?? evt.runId.slice(0, 8);
                    const step = evt.stepId ?? "unknown";
                    const msg = `FAILED: ${ticket} at step "${step}"${evt.detail ? `\n${evt.detail}` : ""}`.trim();
                    for (const chatId of cfg.allowedChatIds) {
                        void bot.api.sendMessage(chatId, msg).catch(() => { });
                    }
                }
                if (evt.event === "run.completed") {
                    const ticket = evt.detail?.match(/AMA-\d+/)?.[0] ?? evt.runId.slice(0, 8);
                    for (const chatId of cfg.allowedChatIds) {
                        void bot.api.sendMessage(chatId, `DONE: ${ticket} completed`).catch(() => { });
                    }
                }
            }
            catch {
                // best-effort: ignore malformed events
            }
        });
    });
    server.listen(cfg.notifyPort, "127.0.0.1", () => {
        console.log(`[bot] Notify endpoint listening on 127.0.0.1:${cfg.notifyPort}`);
    });
}
main().catch((err) => {
    console.error("[bot] Fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
});
