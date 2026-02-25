# OpenClaw Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure prompt architecture for main + antfarm agents, add learnings-from-failures loop, two-tier notification batching, and hourly backup to Amakaflow/openclaw-backup.

**Architecture:** Four independent features in priority order. Prompt architecture touches `~/.openclaw/workspace/` MD files and antfarm `workflow.yml`. Learnings loop enhances the existing morning-status cron prompt. Notifications suppress non-critical events. Backup is a new launchd Node.js script mirroring files to a private GitHub repo.

**Tech Stack:** Node.js, SQLite (sqlite3 CLI), openclaw CLI, launchd, gh CLI, Kimi for crons, MiniMax for developer agent

---

## Task 1: Restructure AGENTS.md

**Files:**
- Modify: `~/.openclaw/workspace/AGENTS.md`

### Step 1: Rewrite AGENTS.md with ownership header, remove antfarm block

Replace the full file content with:

```markdown
# AGENTS.md — Your Workspace

<!-- WHAT BELONGS HERE: session startup sequence, memory instructions, safety rules, external vs internal rules -->
<!-- WHAT DOES NOT BELONG HERE: antfarm policy (→ TOOLS.md), project details (→ MEMORY.md), tool usage (→ TOOLS.md) -->

## First Run

If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it.

## Every Session

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. **If in MAIN SESSION** (direct chat with your human): Also read `MEMORY.md`

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term index:** `MEMORY.md` — curated pointers (main session only)
- **Topic files:** `memory/topics/*.md` — detailed reference, searchable via QMD
- **Write it down** — mental notes don't survive restarts. Text > Brain.

For any topic: `openclaw memory search "<topic>"`

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` (recoverable beats gone forever)
- When in doubt, ask.

## External vs Internal

**Safe to do freely:** Read files, explore, organize, learn, search the web, work within this workspace.

**Ask first:** Sending emails, public posts, anything that leaves the machine.

## Group Chats & Heartbeats

For group chat etiquette: `openclaw memory search "group chat etiquette"`
For heartbeat usage: `openclaw memory search "heartbeat guide"`
```

### Step 2: Verify antfarm block is gone

```bash
grep -c "antfarm:workflows" ~/.openclaw/workspace/AGENTS.md
```
Expected: `0`

### Step 3: Commit

```bash
git -C ~/.openclaw/workspace add AGENTS.md
git -C ~/.openclaw/workspace commit -m "refactor: restructure AGENTS.md with ownership header, move antfarm block to TOOLS.md"
```

---

## Task 2: Expand USER.md

**Files:**
- Modify: `~/.openclaw/workspace/USER.md`

### Step 1: Rewrite USER.md with communication preferences

Replace full file content with:

```markdown
# USER.md — About Your Human

<!-- WHAT BELONGS HERE: David's identity, preferences, communication style, goals -->
<!-- WHAT DOES NOT BELONG HERE: technical config, project status (→ MEMORY.md), tool details (→ TOOLS.md) -->

- **Name:** David
- **Call them:** David
- **Pronouns:** he/him
- **Timezone:** Central US (America/Chicago)
- **Telegram:** 7888191549

## What David is Building

AmakaFlow — a fitness coaching platform for gym trainees, HYROX athletes, triathletes, group fitness participants, and personal trainers. AI-powered coaching + workout programming + health tracking across web/mobile. David uses the app himself while building it.

## Communication Preferences

- Direct, no fluff — get to the point
- Short responses unless depth is needed
- No emojis unless explicitly asked
- Telegram alerts: critical = immediate, daily summaries = morning digest only
- GitHub org for all new repos: **Amakaflow**

## Goals

1. Ship AmakaFlow to production-ready quality via automated antfarm pipeline
2. Keep AI costs under control (see `memory/topics/cost-rules.md`)
3. Automate as much dev work as possible
```

### Step 2: Verify

```bash
wc -l ~/.openclaw/workspace/USER.md
```
Expected: ~25 lines

### Step 3: Commit

```bash
git -C ~/.openclaw/workspace add USER.md
git -C ~/.openclaw/workspace commit -m "refactor: expand USER.md with communication preferences and Amakaflow org"
```

---

## Task 3: Update TOOLS.md (absorb antfarm block, add ownership header)

**Files:**
- Modify: `~/.openclaw/workspace/TOOLS.md`

### Step 1: Add ownership header and clean up antfarm block

At the very top of TOOLS.md, add:

```markdown
<!-- WHAT BELONGS HERE: tool reference, antfarm CLI commands, workflow policy, integration credentials -->
<!-- WHAT DOES NOT BELONG HERE: personality/values (→ SOUL.md), memory content (→ MEMORY.md) -->
```

The `<!-- antfarm:workflows -->` block is already in TOOLS.md — keep it as-is but expand the antfarm section with current CLI path:

Replace the antfarm block with:

```markdown
<!-- antfarm:workflows -->
## Antfarm Workflow Policy

<!-- WHAT BELONGS HERE: antfarm CLI commands, workflow lifecycle, cron management -->

Antfarm CLI (always use full path):
`node ~/.openclaw/workspace/antfarm/dist/cli/cli.js`

**Common commands:**
- Install: `antfarm workflow install <name>`
- Run: `antfarm workflow run <workflow-id> "<task>"`
- Status: `antfarm workflow list`
- Logs: `antfarm workflow logs <run-id>`
- Medic: `antfarm medic run`

**Cron management:**
- List: `openclaw cron list`
- Kick: `openclaw cron run <id>`
- Ensure crons: `antfarm workflow ensure-crons <name>`

Workflows are self-advancing via per-agent cron jobs polling SQLite. No manual orchestration needed once a run starts. Crons are created on first run and torn down when all runs complete.

**Backup repo:** `Amakaflow/openclaw-backup` (private)
<!-- /antfarm:workflows -->
```

### Step 2: Verify header is present

```bash
head -3 ~/.openclaw/workspace/TOOLS.md
```
Expected: ownership comment on line 1-2

### Step 3: Commit

```bash
git -C ~/.openclaw/workspace add TOOLS.md
git -C ~/.openclaw/workspace commit -m "refactor: add ownership header to TOOLS.md, expand antfarm section"
```

---

## Task 4: Trim MEMORY.md to index-only

**Files:**
- Modify: `~/.openclaw/workspace/MEMORY.md`

### Step 1: Rewrite MEMORY.md as a clean index

The current MEMORY.md has outdated infrastructure notes. Replace with a trimmed index:

```markdown
# MEMORY.md — Long-Term Index

<!-- WHAT BELONGS HERE: key insights, pointers to topic files, current project status summary -->
<!-- WHAT DOES NOT BELONG HERE: detailed config (→ topic files), antfarm ops (→ topics/antfarm-learnings.md) -->
<!-- MAX 40 LINES — move detail to memory/topics/*.md -->

## Active Projects
- **AmakaFlow** — fitness coaching platform (web + mobile). Details: `openclaw memory search "project status"`
- **Antfarm pipeline** — automated dev workflow processing Linear tickets assigned to Joshua

## Key References
- Linear workflow & PR process: `openclaw memory search "linear ticket workflow"`
- Code review standards & FastAPI patterns: `openclaw memory search "code review standards"`
- API keys & git config: `openclaw memory search "api keys config"`
- Cost rules: `memory/topics/cost-rules.md`
- Antfarm pipeline lessons: `memory/topics/antfarm-learnings.md`
- MiniMax quirks: `memory/topics/minimax-learnings.md`
- Recurring errors & fixes: `memory/topics/errors.md`

## Key Insights
1. MiniMax M2.5 ignores output format instructions mid-prompt — put format block LAST with concrete example
2. Antfarm auto-kick is event-driven (`triggerAgentCron()`); 5-min polling is fallback only
3. `operator.write` scope required in `paired.json` for `sessions_spawn`
4. Amakaflow GitHub org is the org for all new repos
5. Kimi (moonshot/kimi-k2.5) is free — use for polling, morning crons, non-coding tasks
6. Medic is a launchd script (no LLM) — only alerts Telegram if issues found
```

### Step 2: Verify line count

```bash
wc -l ~/.openclaw/workspace/MEMORY.md
```
Expected: ≤ 40 lines

### Step 3: Commit

```bash
git -C ~/.openclaw/workspace add MEMORY.md
git -C ~/.openclaw/workspace commit -m "refactor: trim MEMORY.md to index-only, add new topic file pointers"
```

---

## Task 5: Create New Topic Files

**Files:**
- Create: `~/.openclaw/workspace/memory/topics/antfarm-learnings.md`
- Create: `~/.openclaw/workspace/memory/topics/minimax-learnings.md`
- Create: `~/.openclaw/workspace/memory/topics/errors.md`

### Step 1: Create antfarm-learnings.md

```markdown
# Antfarm Pipeline Learnings

<!-- Written by morning-status cron when failures are found. Append-only. Do not restructure manually. -->
<!-- Last updated: 2026-02-25 (initial seed) -->

## Pipeline Patterns

- MiniMax M2.5 ignores output format instructions when buried mid-prompt — put format LAST
- Workflow v4+ uses fallback discovery for missing output keys (git ls-remote, gh pr list)
- Dirty retry fix: `rm -rf /tmp/{{ticket_id}}-work` before clone prevents `fatal: already exists`
- Force branch: `git checkout -B` instead of `-b` prevents branch-already-exists on retry
- `operator.write` scope required in `~/.openclaw/devices/paired.json` for sessions_spawn
- Step ordering enforced: a step only claims when all prior steps in same run are `done`
- Crons are created on first run, torn down when all runs complete — absent crons = no active runs (normal)
- Medic now auto-reinstalls missing crons via `register_crons` remediation after gateway restart

## Step-Specific Patterns

### pick_ticket
- Always patch the Linear ticket description with `## Test command:` before completing
- Verify no duplicate PRs exist before picking

### develop (mini-developer / MiniMax)
- 90% success rate; failures are usually "already implemented" tickets or transient rate limits
- max_retries: 4 — MiniMax transient failures are retryable
- Script: `~/.openclaw/antfarm/scripts/mini-develop.sh` — polls for completion every 60s, 4hr max

### run_tests (developer / MiniMax)
- Android/Kotlin projects: skip local tests (no JDK), return TESTS_PASSED: true
- CI runs `./gradlew testDebugUnitTest` on the PR automatically

### audit / closer
- Use Kimi — lightweight review + PR merge steps
- If BRANCH or PR_URL contain `[missing:...]`, use fallback discovery
```

### Step 2: Create minimax-learnings.md

```markdown
# MiniMax M2.5 Behaviour Notes

<!-- Written by morning-status cron when model-specific issues are found. Append-only. -->
<!-- Last updated: 2026-02-25 (initial seed) -->

## Output Format Behaviour

- **Ignores** output format instructions when they appear mid-prompt or at the top
- **Follows** concrete examples better than descriptions
- Put `===OUTPUT FORMAT===` block LAST in every prompt, single occurrence
- Include at least one complete filled-in example, not just field names
- Keep step inputs under 400 words where possible — longer prompts reduce compliance

## Reliability

- ~90% success rate on develop step across 39 runs
- Transient failures (gateway timeout, rate limit) are retryable — set `max_retries: 4`
- "Already implemented" tickets cause false failures — not a model issue, skip gracefully

## Speed

- Highspeed variant (`minimax/MiniMax-M2.5-highspeed`): ~100 tok/s vs 51 tok/s standard
- Same model quality, 2x faster — always prefer highspeed for developer agent
- Coding plan: rolling 5-hour window; pay-as-you-go fallback on `sk-api-*` key

## Prompt Engineering Rules for MiniMax

1. Task description first — what to do, step by step, numbered
2. Reference files to read (e.g. LEARNINGS.md) in the task section
3. Output format LAST, always, no exceptions
4. Use `===OUTPUT FORMAT===` and `===END OUTPUT FORMAT===` markers
5. Include a complete filled-in example output
```

### Step 3: Create errors.md

```markdown
# Recurring Error Patterns

<!-- Written by morning-status cron when patterns detected. Also update manually after fixing known issues. -->
<!-- Last updated: 2026-02-25 (initial seed) -->

## antfarm.db Stuck Steps

**Symptom:** Step stays `running` after gateway restart; medic reports stall.
**Fix:**
```bash
sqlite3 ~/.openclaw/antfarm/antfarm.db \
  "UPDATE steps SET status='pending', updated_at=datetime('now') WHERE id='<step-id>' AND status='running';"
```
Clear stale cron session: remove entry from `~/.openclaw/agents/<agent-id>/sessions/sessions.json`

## sessions_spawn "pairing required"

**Symptom:** Cron claims step then immediately releases to pending. Gateway logs show "pairing required".
**Fix:** Add `"operator.write"` to device scopes in `~/.openclaw/devices/paired.json`

## MiniMax Output Parse Failure

**Symptom:** Step fails with "missing output key: BRANCH" or similar.
**Fix:** Audit/merge steps use fallback discovery (git ls-remote + gh pr list). Check workflow version ≥ v4.

## Gateway Restart Loses Crons

**Symptom:** Active runs exist but no agent crons registered — pipeline stalls.
**Fix:** Medic now auto-detects and reinstalls via `checkMissingCrons()`. Manual fix: `antfarm workflow ensure-crons ai-developer`

## DeepSeek 401 Errors

**Symptom:** Any step using deepseek fails with authentication error.
**Fix:** DeepSeek key expired as of Feb 17. Remove from fallback chain; use Kimi instead.
```

### Step 4: Re-index QMD memory

```bash
openclaw memory index --force
```
Expected: indexing completes without errors

### Step 5: Commit

```bash
git -C ~/.openclaw/workspace add memory/topics/antfarm-learnings.md memory/topics/minimax-learnings.md memory/topics/errors.md
git -C ~/.openclaw/workspace commit -m "feat: add antfarm-learnings, minimax-learnings, errors topic files"
```

---

## Task 6: Create ai-developer LEARNINGS.md

**Files:**
- Create: `~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md`

### Step 1: Create LEARNINGS.md

```markdown
# AmakaFlow Codebase — Developer Learnings

Read this BEFORE starting any develop step. Updated nightly by morning-status cron.

## Repositories

- Android app: `supergeri/amakaflow-android-app` (Kotlin/Compose/Gradle)
- Backend API: FastAPI (Python), Postgres, Redis
- Mobile: React Native / Expo

## Branch Naming

`ama-<ticket-number>-<short-description>` — e.g. `ama-737-add-conflict-marker-ci`

Always use `git checkout -B <branch>` (not `-b`) to avoid branch-already-exists errors on retry.

## Work Directory

Clean before cloning: `rm -rf /tmp/{{ticket_id}}-work`

## Common Gotchas

- Android projects: no local JDK — skip local tests, CI handles `./gradlew testDebugUnitTest`
- Always check for existing PRs before opening a new one: `gh pr list --repo <repo> --head <branch>`
- Test command must be added to Linear ticket description under `## Test command:`

## Codebase Patterns

- Follow existing file structure — don't create new directories without reason
- Prefer editing existing files over creating new ones
- Keep changes minimal and focused on the ticket requirements

===OUTPUT FORMAT===
When you complete the develop step, output EXACTLY this (filled in):

STATUS: done
BRANCH: ama-XXX-your-branch-name
PR_URL: https://github.com/supergeri/amakaflow-android-app/pull/99
CHANGES: One-line summary of what was implemented

If failed:

STATUS: fail
REASON: Brief description of what went wrong
===END OUTPUT FORMAT===
```

### Step 2: Verify file exists

```bash
cat ~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md | head -5
```
Expected: first 5 lines of the file

### Step 3: Commit

```bash
git -C ~/.openclaw/workspace/antfarm add workflows/ 2>/dev/null || true
# LEARNINGS.md is in installed location — also copy to source
cp ~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md \
   ~/.openclaw/workspace/antfarm/workflows/ai-developer/LEARNINGS.md 2>/dev/null || true
```

---

## Task 7: Update Developer Step Prompt in workflow.yml for MiniMax

**Files:**
- Modify: `~/.openclaw/antfarm/workflows/ai-developer/workflow.yml` (installed copy)
- Sync: `~/.openclaw/workspace/antfarm/workflows/ai-developer/workflow.yml`

### Step 1: Read the current run_tests step input

```bash
grep -n "run_tests\|output format\|OUTPUT FORMAT\|🚨" \
  ~/.openclaw/antfarm/workflows/ai-developer/workflow.yml | head -20
```

### Step 2: Restructure run_tests step input

The run_tests step uses MiniMax. Currently it puts output format at the TOP (ignored) and repeats at bottom. Fix: remove top format block, keep ONLY the bottom one, add LEARNINGS.md reference.

Find the run_tests input section (starts after `- id: run_tests`) and replace:

**Remove** the top block (lines starting with `🚨 CRITICAL: OUTPUT FORMAT...` through the first `═══` divider).

**Add** at the top of the task instructions (after `Run the test suite for...`):

```
Read ~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md before starting.
```

**Keep and clean** the bottom output format block — replace the `🚨 REMINDER` block with:

```
===OUTPUT FORMAT===
Respond with EXACTLY these keys:

If tests PASS:
STATUS: done
TESTS_PASSED: true
TEST_OUTPUT: 14 passed, 0 failed

If tests FAIL:
STATUS: fail
TESTS_PASSED: false
TEST_OUTPUT: test_auth.py::test_login FAILED - AssertionError: expected 200, got 401
===END OUTPUT FORMAT===
```

### Step 3: Sync to source

```bash
cp ~/.openclaw/antfarm/workflows/ai-developer/workflow.yml \
   ~/.openclaw/workspace/antfarm/workflows/ai-developer/workflow.yml
```

### Step 4: Commit

```bash
cd ~/.openclaw/workspace/antfarm && git add workflows/
git commit -m "refactor: restructure run_tests step prompt for MiniMax — output format last with example"
```

---

## Task 8: Enhance morning-status Cron Prompt

**Cron ID:** `c9703ad3-e753-460b-a80e-f7e2c66a7ff3`
**Model:** moonshot/kimi-k2.5 (already updated)

### Step 1: Update cron message via openclaw CLI

```bash
openclaw cron edit c9703ad3-e753-460b-a80e-f7e2c66a7ff3 --message "$(cat <<'PROMPT'
You are the morning status agent for David's AmakaFlow development pipeline.

## Step 1: Antfarm Status

Run: node ~/.openclaw/workspace/antfarm/dist/cli/cli.js workflow list
Count completed, running, and failed runs from the last 24 hours.

## Step 2: Failure Analysis (CRITICAL)

For any runs that failed or were cancelled in the last 24 hours:

1. Query the database for failed step outputs:
sqlite3 ~/.openclaw/antfarm/antfarm.db \
  "SELECT s.step_id, s.output, r.task FROM steps s JOIN runs r ON r.id=s.run_id WHERE s.status='failed' AND s.updated_at > datetime('now','-24 hours') LIMIT 20;"

2. For each failure, classify it:
   - Pipeline issue (stuck step, cron missing, gateway restart) → append to ~/.openclaw/workspace/memory/topics/antfarm-learnings.md
   - MiniMax output format failure (missing output key) → append to ~/.openclaw/workspace/memory/topics/minimax-learnings.md
   - Recurring error (auth failure, DB issue) → append to ~/.openclaw/workspace/memory/topics/errors.md

3. Only append NOVEL lessons — search existing file content first to avoid duplicates.

Append format (add to bottom of relevant file):
## [date] — [ticket-id]
- [one-line lesson learned]

## Step 3: Medic Check

Run: node ~/.openclaw/workspace/antfarm/dist/cli/cli.js medic run
Report any issues found.

## Step 4: Telegram Summary

Send via: openclaw message send --channel telegram --target 7888191549 --message "..."

Include ONLY:
- Failed runs (ticket ID + reason, one line each)
- New lessons learned (if any)
- Medic issues (if any)
- Count of completions (e.g. "3 runs completed overnight")

Do NOT list individual step completions or PR details — keep it under 15 lines.
PROMPT
)"
```

### Step 2: Verify update

```bash
openclaw cron list --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
for j in d.get('jobs', []):
    if j['name'] == 'morning-status':
        print('model:', j['payload']['model'])
        print('message preview:', j['payload']['message'][:100])
"
```
Expected: model = moonshot/kimi-k2.5, message starts with "You are the morning status agent"

---

## Task 9: Create Backup Runner Script

**Files:**
- Create: `~/.openclaw/antfarm/backup-runner.js`

### Step 1: Initialize the backup git repo locally

```bash
BACKUP_DIR="$HOME/.openclaw/backup-repo"
gh repo clone Amakaflow/openclaw-backup "$BACKUP_DIR" 2>/dev/null || \
  git clone https://github.com/Amakaflow/openclaw-backup.git "$BACKUP_DIR"
echo "Cloned to $BACKUP_DIR"
```

### Step 2: Create a README in the backup repo and push

```bash
BACKUP_DIR="$HOME/.openclaw/backup-repo"
cat > "$BACKUP_DIR/README.md" << 'EOF'
# openclaw-backup

Automated hourly backup of OpenClaw workspace, memory, and antfarm DB.

## Contents

- `workspace/` — prompt architecture MD files (AGENTS.md, SOUL.md, USER.md, TOOLS.md, MEMORY.md)
- `workspace/memory/` — daily journals and topic files
- `antfarm.sql` — SQLite dump of antfarm.db (runs, steps, medic_checks)
- `openclaw.redacted.json` — openclaw.json with API keys redacted
- `ai-developer-LEARNINGS.md` — workflow learnings file

## Restore

1. Clone this repo
2. Restore MD files to `~/.openclaw/workspace/`
3. Restore DB: `sqlite3 ~/.openclaw/antfarm/antfarm.db < antfarm.sql`
4. Restore config: `cp openclaw.redacted.json ~/.openclaw/openclaw.json` (re-add API keys manually)
EOF
git -C "$BACKUP_DIR" add README.md
git -C "$BACKUP_DIR" commit -m "chore: initial backup repo setup"
git -C "$BACKUP_DIR" push origin main
```

### Step 3: Write backup-runner.js

```javascript
#!/usr/bin/env node
/**
 * Antfarm Backup Runner
 *
 * Runs hourly via launchd. Backs up workspace MD files, memory, antfarm DB,
 * and redacted openclaw.json to Amakaflow/openclaw-backup (private GitHub repo).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOME = process.env.HOME;
const BACKUP_DIR = path.join(HOME, '.openclaw/backup-repo');
const LOG_PATH = path.join(HOME, '.openclaw/antfarm/backup-runner.log');
const LOG_RETAIN_LINES = 200;
const WORKSPACE = path.join(HOME, '.openclaw/workspace');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

function trimLog() {
  try {
    const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
    if (lines.length > LOG_RETAIN_LINES) {
      fs.writeFileSync(LOG_PATH, lines.slice(-LOG_RETAIN_LINES).join('\n') + '\n');
    }
  } catch { /* ignore */ }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', timeout: 60000, ...opts }).trim();
}

function redactApiKeys(content) {
  return content
    .replace(/"apiKey"\s*:\s*"[^"]+"/g, '"apiKey": "[REDACTED]"')
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token": "[REDACTED]"')
    .replace(/"password"\s*:\s*"[^"]+"/g, '"password": "[REDACTED]"')
    .replace(/sk-[a-zA-Z0-9\-_]{10,}/g, '[REDACTED]')
    .replace(/lin_api_[a-zA-Z0-9]+/g, '[REDACTED]')
    .replace(/sk-cp-[a-zA-Z0-9]+/g, '[REDACTED]')
    .replace(/sk-api-[a-zA-Z0-9]+/g, '[REDACTED]');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(src)) return;
  run(`rsync -a --include="*.md" --exclude="*" "${src}/" "${dest}/"`);
}

function main() {
  log('--- Backup check ---');

  if (!fs.existsSync(BACKUP_DIR)) {
    log('ERROR: Backup repo not found at ' + BACKUP_DIR + ' — run setup first');
    process.exit(1);
  }

  // Pull latest first to avoid conflicts
  try {
    run(`git -C "${BACKUP_DIR}" pull --rebase origin main`);
  } catch (e) {
    log(`WARN: git pull failed: ${e.message.split('\n')[0]}`);
  }

  // 1. Workspace root MD files
  const backupWorkspace = path.join(BACKUP_DIR, 'workspace');
  fs.mkdirSync(backupWorkspace, { recursive: true });
  const mdFiles = fs.readdirSync(WORKSPACE).filter(f => f.endsWith('.md'));
  for (const f of mdFiles) {
    fs.copyFileSync(path.join(WORKSPACE, f), path.join(backupWorkspace, f));
  }

  // 2. Memory directory (daily journals + topic files)
  copyDir(path.join(WORKSPACE, 'memory'), path.join(backupWorkspace, 'memory'));

  // 3. SQLite dump
  const dbPath = path.join(HOME, '.openclaw/antfarm/antfarm.db');
  const dumpPath = path.join(BACKUP_DIR, 'antfarm.sql');
  if (fs.existsSync(dbPath)) {
    try {
      run(`sqlite3 "${dbPath}" .dump > "${dumpPath}"`);
    } catch (e) {
      log(`WARN: DB dump failed: ${e.message.split('\n')[0]}`);
    }
  }

  // 4. Redacted openclaw.json
  const configPath = path.join(HOME, '.openclaw/openclaw.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(path.join(BACKUP_DIR, 'openclaw.redacted.json'), redactApiKeys(raw));
  }

  // 5. LEARNINGS.md
  const learningsPath = path.join(HOME, '.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md');
  if (fs.existsSync(learningsPath)) {
    fs.copyFileSync(learningsPath, path.join(BACKUP_DIR, 'ai-developer-LEARNINGS.md'));
  }

  // Check if anything changed
  const status = run(`git -C "${BACKUP_DIR}" status --porcelain`);
  if (!status) {
    log('No changes — skipping commit');
    return;
  }

  // Commit and push
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  run(`git -C "${BACKUP_DIR}" add -A`);
  run(`git -C "${BACKUP_DIR}" -c user.email="backup@openclaw.local" -c user.name="OpenClaw Backup" commit -m "backup: ${timestamp} — auto"`);
  run(`git -C "${BACKUP_DIR}" push origin main`);
  log(`Backup committed and pushed (${status.split('\n').length} file(s) changed)`);
  trimLog();
}

main().catch(e => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});
```

### Step 4: Test the script (dry run — just check no syntax errors)

```bash
node --check ~/.openclaw/antfarm/backup-runner.js && echo "Syntax OK"
```
Expected: `Syntax OK`

### Step 5: Run once to verify it works

```bash
node ~/.openclaw/antfarm/backup-runner.js
```
Expected: log output ending with "Backup committed and pushed" or "No changes — skipping commit"

---

## Task 10: Create Backup Launchd Plist

**Files:**
- Create: `~/Library/LaunchAgents/com.openclaw.antfarm.backup-runner.plist`

### Step 1: Write plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.antfarm.backup-runner</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/davidmini/.openclaw/antfarm/backup-runner.js</string>
    </array>

    <key>StartInterval</key>
    <integer>3600</integer>

    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/davidmini/.openclaw/antfarm/backup-runner-launchd.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/davidmini/.openclaw/antfarm/backup-runner-launchd.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/davidmini</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
```

### Step 2: Load launchd plist

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.antfarm.backup-runner.plist && echo "loaded"
```
Expected: `loaded`

### Step 3: Verify launchd job is registered

```bash
launchctl list | grep backup-runner
```
Expected: entry with label `com.openclaw.antfarm.backup-runner`

### Step 4: Commit everything

```bash
cd ~/.openclaw/workspace/antfarm
git add workflows/ai-developer/LEARNINGS.md 2>/dev/null || true
git add docs/plans/2026-02-25-openclaw-improvements-plan.md
git commit -m "feat: add openclaw improvements plan + LEARNINGS.md"
git push fork custom
```

---

## Verification Checklist

After all tasks complete, verify:

```bash
# 1. Prompt files restructured
grep -c "WHAT BELONGS HERE" ~/.openclaw/workspace/AGENTS.md  # → 1
grep -c "WHAT BELONGS HERE" ~/.openclaw/workspace/USER.md    # → 1
grep -c "Amakaflow" ~/.openclaw/workspace/USER.md            # → 1

# 2. Topic files exist
ls ~/.openclaw/workspace/memory/topics/ | grep -E "antfarm-learnings|minimax-learnings|errors"

# 3. LEARNINGS.md in workflow
ls ~/.openclaw/antfarm/workflows/ai-developer/LEARNINGS.md

# 4. morning-status updated
openclaw cron list --json | python3 -c "
import json,sys; d=json.load(sys.stdin)
for j in d.get('jobs',[]):
    if j['name']=='morning-status': print(j['payload']['message'][:60])
"  # → starts with "You are the morning status agent"

# 5. Backup launchd running
launchctl list | grep backup-runner  # → entry present

# 6. Backup repo has files
ls ~/.openclaw/backup-repo/workspace/*.md
```

---

## Notes

- `SOUL.md` is **not modified** — it's stable and already well-structured
- `antfarm-learnings.md`, `minimax-learnings.md`, `errors.md` start with seed content; morning-status cron will append real lessons nightly
- The run_tests step prompt change (Task 7) requires reading the actual workflow.yml carefully before editing — the output format block location may differ slightly from what's documented here
- All Amakaflow repos use the `Amakaflow` GitHub org going forward
