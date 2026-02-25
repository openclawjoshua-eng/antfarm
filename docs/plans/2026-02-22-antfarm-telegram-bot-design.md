# Antfarm Telegram Control Bot — Design

**Date:** 2026-02-22
**Status:** Approved

## Problem

When multiple Antfarm runs are executing simultaneously, there is no easy way to see what is happening or intervene without using the CLI. Telegram currently receives one-way notifications (auto-starter start alerts, morning brief) but has no interactive capability.

## Solution

Add a Grammy-based Telegram bot daemon to Antfarm. It runs alongside the existing dashboard daemon, reads the SQLite database directly for status queries, spawns CLI commands for control actions, and queries the Linear API for ticket management. All interaction is via natural language, interpreted by Claude Haiku.

## Architecture

```
User (Telegram)
    → Grammy bot (Antfarm daemon process)
        ├── SQLite (direct read — runs, steps, events)
        ├── child_process.spawn → antfarm CLI (control)
        ├── child_process.spawn → openclaw CLI (cron kicks)
        └── Linear GraphQL API (ticket queries + mutations)
    → formatted Telegram reply
```

No new ports. No Docker. No external service. Bot runs as a Node.js child process managed by the Antfarm daemon controller.

## Commands (Natural Language → Action)

### Status Queries (SQLite reads)
- `what's running?` → list active runs with current step + ticket ID
- `status of AMA-123` → step-by-step breakdown for a specific run
- `what failed recently?` → last N failed/cancelled runs with reason

### Run Control (CLI spawns)
- `start AMA-456` → `antfarm workflow run ai-developer AMA-456` + kick cron
- `cancel AMA-123` → mark run cancelled in SQLite, stop advancement
- `retry develop for AMA-123` → reset step to pending, kick cron
- `kick crons` → `openclaw cron run` for all active agent crons

### Linear Integration (GraphQL API)
- `what's in backlog?` → list unstarted + backlog tickets assigned to Joshua
- `status of AMA-123` (when not running) → ticket title, description, Linear state
- `move AMA-123 to in progress` → update Linear state
- `assign AMA-789 to Joshua` → update assignee

### Proactive Alerts (push from Antfarm → bot → Telegram)
- Step failures pushed immediately (extend existing event webhook handler)
- Replace morning-status cron Telegram delivery with bot's richer summary

## File Structure

New files in `src/bot/`:

```
src/bot/
  bot.ts       — Grammy setup, message handler, Claude Haiku intent parsing
  actions.ts   — Status queries (SQLite), run control (CLI), cron management
  linear.ts    — Linear GraphQL client: ticket queries + state/assignee mutations
  botctl.ts    — Daemon start/stop/status (mirrors existing daemonctl.ts pattern)
```

Modified files:
- `src/installer/events.ts` — extend event emission to push failures to bot
- `src/cli/cli.ts` — add `antfarm bot start/stop/status` subcommands
- `~/.openclaw/openclaw.json` — add `telegram.botToken` + `telegram.allowedChatIds`

## Configuration

In `openclaw.json`:
```json
"telegram": {
  "botToken": "<Grammy bot token>",
  "allowedChatIds": [7888191549]
}
```

Bot token is the existing `@supergeri_openclawbot` token (already used by OpenClaw).

## Security

- Allowlist of `allowedChatIds` — messages from any other chat ID are silently ignored
- Bot token stored in `openclaw.json` (already protected, same as other secrets)
- Control actions (cancel, retry) require confirmation reply before executing

## Deployment

Bot launches as part of `antfarm start` (alongside dashboard daemon). Also available standalone via `antfarm bot start`. PID written to `~/.openclaw/antfarm/bot.pid`.

## Success Criteria

- `what's running?` returns a formatted list of active runs in under 2 seconds
- `start AMA-456` kicks off a run and confirms in Telegram
- `cancel AMA-123` cancels a run and confirms
- `what's in backlog?` returns current Linear backlog
- Step failures are pushed to Telegram within 5 seconds of occurrence
- Unknown chat IDs receive no response
