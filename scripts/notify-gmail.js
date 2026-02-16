#!/usr/bin/env node
// Antfarm → Gmail notification bridge
// Zero dependencies — uses Node.js built-in modules only
// Receives webhook POSTs from Antfarm events and sends email via Gmail SMTP

import { createServer } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";

const PORT = parseInt(process.env.ANTFARM_NOTIFY_PORT || "9876", 10);
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const GMAIL_TO = process.env.GMAIL_TO || GMAIL_USER;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variables");
  process.exit(1);
}

// Events worth emailing about
const NOTIFY_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "step.failed",
  "step.retry_step",
]);

function formatSubject(evt) {
  const { event, stepId, detail, runId } = evt;
  const short = runId ? runId.slice(0, 8) : "unknown";

  switch (event) {
    case "step.failed":
      return `[Antfarm] ESCALATION: ${stepId || "step"} failed (${short})`;
    case "run.failed":
      return `[Antfarm] Run FAILED (${short})`;
    case "run.completed":
      return `[Antfarm] Run completed (${short})`;
    case "step.retry_step":
      return `[Antfarm] Retrying: ${detail || stepId || "step"} (${short})`;
    default:
      return `[Antfarm] ${event} (${short})`;
  }
}

function formatBody(evt) {
  const lines = [
    `Event:     ${evt.event}`,
    `Timestamp: ${evt.ts}`,
    `Run ID:    ${evt.runId}`,
  ];
  if (evt.workflowId) lines.push(`Workflow:  ${evt.workflowId}`);
  if (evt.stepId) lines.push(`Step:      ${evt.stepId}`);
  if (evt.agentId) lines.push(`Agent:     ${evt.agentId}`);
  if (evt.detail) lines.push(`\nDetail:\n${evt.detail}`);
  lines.push(`\n---\nSent by Antfarm notification bridge`);
  return lines.join("\n");
}

// Minimal SMTP client using STARTTLS (Gmail port 587)
function sendEmail(subject, body) {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: "smtp.gmail.com", port: 587 }, () => {
      let buffer = "";
      let tlsSocket = null;
      let step = 0;

      const commands = [
        // step 0: wait for greeting
        null,
        // step 1: EHLO
        `EHLO localhost\r\n`,
        // step 2: STARTTLS
        `STARTTLS\r\n`,
        // step 3: EHLO again (after TLS upgrade)
        `EHLO localhost\r\n`,
        // step 4: AUTH LOGIN
        `AUTH LOGIN\r\n`,
        // step 5: username (base64)
        Buffer.from(GMAIL_USER).toString("base64") + "\r\n",
        // step 6: password (base64)
        Buffer.from(GMAIL_APP_PASSWORD).toString("base64") + "\r\n",
        // step 7: MAIL FROM
        `MAIL FROM:<${GMAIL_USER}>\r\n`,
        // step 8: RCPT TO
        `RCPT TO:<${GMAIL_TO}>\r\n`,
        // step 9: DATA
        `DATA\r\n`,
        // step 10: email content
        [
          `From: Antfarm <${GMAIL_USER}>`,
          `To: ${GMAIL_TO}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          body,
          `.`,
          ``,
        ].join("\r\n"),
        // step 11: QUIT
        `QUIT\r\n`,
      ];

      function processLine(line) {
        const code = parseInt(line.slice(0, 3), 10);

        // Multi-line responses (e.g. 250-SIZE, 250-STARTTLS, 250 OK)
        if (line[3] === "-") return;

        if (step === 2 && code === 220) {
          // Upgrade to TLS
          tlsSocket = tlsConnect({ socket, servername: "smtp.gmail.com" }, () => {
            step++;
            sendNext();
          });
          tlsSocket.on("data", onData);
          tlsSocket.on("error", reject);
          return;
        }

        if (code >= 400) {
          reject(new Error(`SMTP error at step ${step}: ${line}`));
          return;
        }

        step++;
        if (step < commands.length) {
          sendNext();
        } else {
          resolve();
        }
      }

      function sendNext() {
        const cmd = commands[step];
        if (cmd) {
          const s = tlsSocket || socket;
          s.write(typeof cmd === "string" ? cmd : cmd);
        }
      }

      function onData(chunk) {
        buffer += chunk.toString();
        const lines = buffer.split("\r\n");
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (line.trim()) processLine(line);
        }
      }

      socket.on("data", onData);
      socket.on("error", reject);
    });

    socket.on("error", reject);
    setTimeout(() => reject(new Error("SMTP timeout")), 30000);
  });
}

// HTTP server
const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const evt = await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(); }
    });
    req.on("error", reject);
  }).catch(() => null);

  if (!evt) {
    res.writeHead(400);
    res.end("Invalid JSON");
    return;
  }

  // Always respond 200 quickly (fire-and-forget from Antfarm's perspective)
  res.writeHead(200);
  res.end("ok");

  if (!NOTIFY_EVENTS.has(evt.event)) return;

  const subject = formatSubject(evt);
  const emailBody = formatBody(evt);

  try {
    await sendEmail(subject, emailBody);
    console.log(`[${new Date().toISOString()}] Email sent: ${subject}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Email failed:`, err.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Antfarm Gmail bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Sending to: ${GMAIL_TO}`);
  console.log(`Events: ${[...NOTIFY_EVENTS].join(", ")}`);
});
