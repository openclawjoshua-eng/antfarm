# OpenClaw Improvements Design
**Date:** 2026-02-25
**Status:** Approved
**Priority order:** Prompt Architecture > Learnings/Log Review > Notification Batching > Backup

---

## 1. Prompt Architecture

### Goal
Restructure MD files for both the main OpenClaw agent and antfarm workflow agents with strict file ownership rules. Optimise antfarm developer step prompts for MiniMax M2.5 behaviour.

### Main Agent File Structure (`~/.openclaw/workspace/`)

| File | Role | What belongs | What does NOT belong |
|---|---|---|---|
| `AGENTS.md` | Session startup + operational rules | Memory startup sequence, safety rules, external vs internal actions | Antfarm policy (→ TOOLS.md), project details (→ MEMORY.md) |
| `SOUL.md` | Identity and values | Personality, communication style, values | Operational rules, tool usage |
| `USER.md` | About David | Name, timezone, goals, preferences, AmakaFlow context | Technical config, project status |
| `TOOLS.md` | Tool reference + antfarm policy | Tool usage patterns, antfarm CLI commands, workflow policy | Memory content, personality |
| `MEMORY.md` | Long-term index | Pointers to topic files, key insights (max 40 lines) | Detailed content (→ topic files) |

**New topic files:**
- `memory/topics/antfarm-learnings.md` — pipeline lessons from run failures (written by morning-status cron)
- `memory/topics/minimax-learnings.md` — MiniMax M2.5 quirks, workarounds, output format tips
- `memory/topics/errors.md` — recurring failure patterns and fixes

### Antfarm Workflow Agent Prompts

**New file:** `~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md`
Injected at the top of the developer step input. Updated nightly by morning-status cron when failures are found.

**MiniMax output format rules** (applied to all developer step inputs):
1. Task instructions first — short, imperative
2. `Read LEARNINGS.md before starting` line
3. Output format block **last**, wrapped in `===OUTPUT FORMAT===` markers
4. Always include a concrete example — MiniMax follows examples, ignores descriptions
5. Keep step inputs under 400 words where possible

---

## 2. Learnings + Morning Log Review

### Goal
The enhanced `morning-status` cron (7am ET, Kimi, already exists) accumulates institutional memory from antfarm failures so the pipeline improves over time.

### What it does (additions to existing morning-status)
1. Query `antfarm.db` for runs failed/cancelled in last 24h
2. Read step output for each failure — extract what went wrong
3. Classify: pipeline issue → `antfarm-learnings.md`, MiniMax behaviour → `minimax-learnings.md`
4. Append only new/novel lessons (deduplicate against existing content)
5. Telegram: failures summary only — what failed, why, what was learned

### Telegram content change
- **Keep:** new run started (auto-starter)
- **Keep:** medic alerts (already immediate)
- **Morning digest only:** step completions, PR opened, run completed
- **Immediate:** run failed after max retries

---

## 3. Notification Batching (Two-Tier)

### Tier 1 — Immediate Telegram
- Run failed (after max retries exhausted)
- Medic critical alert
- Gateway down

### Tier 2 — Morning Digest (morning-status cron)
- Runs completed overnight
- PRs merged
- New runs started (unless auto-starter ping already sent)

No new infrastructure — just update the morning-status prompt and suppress non-critical workflow events.

---

## 4. Automated Backup

### Repo
`Amakaflow/openclaw-backup` (private, already created)

### Script
`~/.openclaw/antfarm/backup-runner.js` — Node.js, runs hourly via launchd
`~/Library/LaunchAgents/com.openclaw.antfarm.backup-runner.plist`

### What gets backed up
| Item | Method |
|---|---|
| `~/.openclaw/workspace/*.md` | git commit (text, diffs cleanly) |
| `~/.openclaw/workspace/memory/` | git commit |
| `~/.openclaw/antfarm/antfarm.db` | SQLite dump to `.sql` file, then git commit |
| `~/.openclaw/openclaw.json` | git commit with API keys redacted |
| `~/.openclaw/workspace/antfarm/workflows/ai-developer/LEARNINGS.md` | git commit |

### Behaviour
- Only commits if files changed (git diff check first)
- Commit message: `backup: YYYY-MM-DD HH:MM — auto`
- Logs to `~/.openclaw/antfarm/backup-runner.log`

---

## Implementation Order

1. Prompt architecture — restructure MD files + create new topic files + LEARNINGS.md + update developer step prompt
2. Enhanced morning-status cron prompt — add failure analysis + learnings append
3. Notification changes — suppress non-critical workflow events
4. Backup script + launchd plist + GitHub repo init

---

## Notes
- All Amakaflow repos going forward use the `Amakaflow` GitHub org
- MiniMax M2.5 constraint: always put output format last with a concrete example
- Backup repo: `Amakaflow/openclaw-backup` (private)
