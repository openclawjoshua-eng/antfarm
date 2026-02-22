import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export function getBotConfig() {
    const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    let raw = {};
    try {
        raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    }
    catch {
        throw new Error(`Cannot read openclaw.json at ${cfgPath}`);
    }
    const bot = raw["antfarmBot"];
    if (!bot?.botToken) {
        throw new Error('Missing "antfarmBot.botToken" in openclaw.json. Create a bot via @BotFather and add it.');
    }
    return {
        botToken: bot.botToken,
        allowedChatIds: bot.allowedChatIds ?? [],
        notifyPort: bot.notifyPort ?? 3334,
    };
}
