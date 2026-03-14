# Design: lossless-claw Integration (Global LCM)

**Date:** 2026-03-14
**Status:** Approved
**Repo:** https://github.com/Martian-Engineering/lossless-claw

## Problem

OpenClaw's default context compaction is a sliding window — when a session fills up, old messages are dropped permanently. For long-running develop sessions (1–4 hours), this means the agent loses its early code exploration by the time it's writing code. The agent remembers the plan but forgets what it found in the files.

This is a known contributor to complex-ticket failures (e.g. AMA-866, 4+ retries on large refactors) where coordinating changes across 15+ files requires retaining context from the full session.

## Solution

Install **lossless-claw** as an OpenClaw `contextEngine` plugin. It replaces sliding-window truncation with a DAG-based summarisation system:

1. All messages persisted to SQLite (`~/.openclaw/lcm.db`)
2. When context hits 75%, older chunks are summarised into DAG nodes
3. DAG cascades to unlimited depth — a 4-hour session compresses to a manageable summary tree
4. 32 most recent messages always kept raw (never compressed)
5. Agents get three search tools: `lcm_grep`, `lcm_describe`, `lcm_expand`

## Architecture

```
Agent session hits 75% context threshold
         │
         ▼
lossless-claw compaction
  ├── last 32 messages → kept raw (fresh tail)
  ├── older messages → summarised into DAG leaf node
  └── existing leaf nodes → condensed into higher DAG levels (unlimited depth)
         │
         ▼
lcm.db (SQLite, ~/.openclaw/lcm.db)
  └── all conversations, all agents, keyed by session ID
```

Agents can recover history via:
- `lcm_grep "keyword"` — full-text search across compacted history
- `lcm_describe <node>` — get a summary of a compressed section
- `lcm_expand <node>` — recover raw messages from a DAG node

## Scope

**Global** — all 35 agents enabled via a single `contextEngine` slot config. No per-agent changes needed. Short-lived cron agents (picker, auditor, closer) benefit minimally but incur zero harm.

## Configuration Changes

### 1. Install plugin
```bash
openclaw plugins install @martian-engineering/lossless-claw
```

### 2. Update `~/.openclaw/openclaw.json`

Add to the `plugins` block:
```json
{
  "plugins": {
    "slots": {
      "contextEngine": "lossless-claw"
    },
    "entries": {
      "lossless-claw": {
        "enabled": true,
        "config": {
          "freshTailCount": 32,
          "contextThreshold": 0.75,
          "incrementalMaxDepth": -1,
          "leafTargetTokens": 1200
        }
      }
    }
  }
}
```

### 3. Restart gateway
```bash
openclaw gateway stop && openclaw gateway install
```

## Settings Rationale

| Setting | Value | Why |
|---|---|---|
| `freshTailCount` | 32 | Recent edits, test output, active reasoning always visible raw |
| `contextThreshold` | 0.75 | Triggers compaction before window is full, leaving headroom for responses |
| `incrementalMaxDepth` | -1 | Unlimited DAG cascading — handles arbitrarily long sessions |
| `leafTargetTokens` | 1200 | Compact summaries; many fit in context simultaneously |

## Storage

- DB path: `~/.openclaw/lcm.db`
- Estimate: ~50–100KB per 2-hour develop session
- At 10 tickets/day: ~1MB/day growth
- Retention: align with OpenClaw's existing 7-day session pruning

## Error Handling

lossless-claw fails gracefully — if compaction fails for any reason, OpenClaw falls back to default sliding-window behaviour. No new pipeline failure modes introduced.

## Expected Impact

| Agent | Benefit |
|---|---|
| ai-developer developer (MiniMax) | High — retains early code exploration on complex tickets; reduces retry rate |
| ai-developer-ui developer (MiniMax) | High — same reasoning |
| main session (David) | High — never loses context on ongoing tickets, pipeline decisions, debugging |
| deep-research workflows | Medium — multi-step research retains earlier findings |
| auditor / closer | Low — short sessions, benefit minimal but harmless |
| picker crons | None — sub-1-minute sessions, no compaction ever triggered |

## MiniMax-Specific Note

MiniMax-M2.5-highspeed (200k context) is used for the develop step. LCM uses the same model to write summaries. This means summary quality is bounded by MiniMax's ability to condense code accurately. Dense TypeScript with complex type interdependencies may compress imperfectly, but structured summaries of file reads and tool outputs should compress well.

## Implementation Steps

1. `openclaw plugins install @martian-engineering/lossless-claw`
2. Edit `~/.openclaw/openclaw.json` — add `slots.contextEngine` + `entries.lossless-claw`
3. `openclaw gateway stop && openclaw gateway install`
4. Verify: open a session, check `openclaw status` shows lossless-claw plugin active
5. Monitor: after 2–3 develop runs, check `lcm.db` is growing and `lcm_grep` works in sessions
