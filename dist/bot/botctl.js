import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function getBotPidFile() {
    return path.join(os.homedir(), ".openclaw", "antfarm", "bot.pid");
}
export function getBotLogFile() {
    return path.join(os.homedir(), ".openclaw", "antfarm", "bot.log");
}
export function isBotRunning() {
    const pidFile = getBotPidFile();
    if (!fs.existsSync(pidFile))
        return { running: false };
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    if (isNaN(pid))
        return { running: false };
    try {
        process.kill(pid, 0);
        return { running: true, pid };
    }
    catch {
        try {
            fs.unlinkSync(pidFile);
        }
        catch { }
        return { running: false };
    }
}
export async function startBotDaemon() {
    const status = isBotRunning();
    if (status.running)
        return { pid: status.pid };
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
export function stopBotDaemon() {
    const status = isBotRunning();
    if (!status.running)
        return false;
    try {
        process.kill(status.pid, "SIGTERM");
    }
    catch { }
    return true;
}
export function getBotDaemonStatus() {
    const status = isBotRunning();
    if (!status.running)
        return { running: false };
    return { running: true, pid: status.pid };
}
