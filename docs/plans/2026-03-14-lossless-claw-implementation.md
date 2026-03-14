# lossless-claw Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install lossless-claw as a global OpenClaw contextEngine plugin, replacing sliding-window compaction with DAG-based summarisation for all 35 agents.

**Architecture:** One plugin install + one JSON config block enables lossless context for every agent. The plugin intercepts the contextEngine slot — no per-agent changes needed. All message history is stored in `~/.openclaw/lcm.db` (separate from `antfarm.db`).

**Tech Stack:** OpenClaw plugin system, lossless-claw (`@martian-engineering/lossless-claw`), SQLite (lcm.db), Node.js gateway

**Design doc:** `docs/plans/2026-03-14-lossless-claw-design.md`

---

### Task 1: Install the plugin

**Files:**
- No files to edit — plugin install is a CLI command

**Step 1: Install lossless-claw via OpenClaw plugin system**

```bash
openclaw plugins install @martian-engineering/lossless-claw
```

Expected: plugin downloads and registers. Should print confirmation with plugin name.

**Step 2: Verify the plugin is registered**

```bash
openclaw plugins list
```

Expected: `lossless-claw` appears in the list.

**Step 3: Commit nothing yet** — config changes come in Task 2.

---

### Task 2: Configure lossless-claw in openclaw.json

**Files:**
- Modify: `~/.openclaw/openclaw.json`

**Step 1: Open the config**

```bash
cat ~/.openclaw/openclaw.json | python3 -m json.tool | grep -A5 '"plugins"'
```

Note the current `plugins` block structure. It will look like:

```json
"plugins": {
  "entries": {
    "telegram": { "enabled": true },
    "minimax-portal-auth": { "enabled": true }
  }
}
```

**Step 2: Add the contextEngine slot and lossless-claw entry**

The full updated `plugins` block must be:

```json
"plugins": {
  "slots": {
    "contextEngine": "lossless-claw"
  },
  "entries": {
    "telegram": { "enabled": true },
    "minimax-portal-auth": { "enabled": true },
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
```

Edit `~/.openclaw/openclaw.json` directly. Preserve all existing keys — only add `slots` and the `lossless-claw` entry.

**Step 3: Validate the JSON is still valid**

```bash
python3 -c "import json; json.load(open('$HOME/.openclaw/openclaw.json')); print('JSON valid')"
```

Expected: `JSON valid` — if you get a parse error, fix the JSON before continuing.

---

### Task 3: Restart the gateway

**Files:** None

**Step 1: Stop and reinstall the gateway**

```bash
openclaw gateway stop && sleep 2 && openclaw gateway install
```

Expected: `Stopped LaunchAgent` then `Installed LaunchAgent`.

**Step 2: Wait for gateway to come up**

```bash
sleep 5 && curl -s http://127.0.0.1:18789/ | head -c 50
```

Expected: HTML response starting with `<!doctype html>`.

**Step 3: Check gateway status**

```bash
openclaw status
```

Expected: gateway shows `running` with a pid. Check the plugins section shows lossless-claw active. If you see `unreachable (missing scope: operator.read)` in the gateway line, that is a known display artefact — the gateway is actually running if `curl` returned HTML above.

---

### Task 4: Verify lossless-claw is active

**Files:** None

**Step 1: Check lcm.db is created**

```bash
ls -lh ~/.openclaw/lcm.db 2>&1
```

Expected: file exists (may be empty initially — it populates on first session use). If `No such file or directory`, trigger a session (Step 2) and check again.

**Step 2: Start a short test session and confirm LCM tools are available**

```bash
openclaw message send --channel cli "List the three lcm tools available to you (lcm_grep, lcm_describe, lcm_expand). Reply with just the names."
```

Expected: the agent lists `lcm_grep`, `lcm_describe`, `lcm_expand`. This confirms the plugin injected the tools into the session.

If the agent says it doesn't have those tools, the contextEngine slot is not wired correctly — go back to Task 2 and verify the `slots.contextEngine` key is at the right level in the JSON.

**Step 3: Verify lcm.db is now populated**

```bash
ls -lh ~/.openclaw/lcm.db && sqlite3 ~/.openclaw/lcm.db "SELECT count(*) FROM messages;" 2>&1
```

Expected: file exists, row count > 0.

---

### Task 5: Kick all antfarm crons

The gateway restart clears in-flight cron state. Kick the key crons so the pipeline resumes.

**Step 1: List current crons**

```bash
openclaw cron list
```

Note the cron IDs for `ai-developer_picker` and `ai-developer-ui_picker`.

**Step 2: Kick picker crons**

```bash
openclaw cron run <ai-developer_picker-cron-id>
openclaw cron run <ai-developer-ui_picker-cron-id>
```

Expected: `openclaw cron run` exits (may timeout at 30s — that is fine, the gateway continues).

**Step 3: Confirm pipeline is moving**

```bash
node ~/.openclaw/workspace/antfarm/dist/cli/cli.js step peek
```

Expected: either `STATUS: no_work` (nothing pending) or a step is claimed and processing.

---

### Task 6: Monitor first develop run with LCM

This is an observational step — no code changes.

**Step 1: Watch for the next develop step to start**

```bash
sqlite3 ~/.openclaw/antfarm/antfarm.db "SELECT id, step_id, status, created_at FROM steps WHERE step_id LIKE '%develop%' ORDER BY created_at DESC LIMIT 5;"
```

**Step 2: Once a develop step is running, confirm lcm.db is growing**

```bash
watch -n30 "ls -lh ~/.openclaw/lcm.db"
```

Expected: file size increases as the session progresses. A 2-hour develop session should produce 50–100KB of DAG data.

**Step 3: After the run completes, spot-check a compacted session**

```bash
sqlite3 ~/.openclaw/lcm.db "SELECT session_id, count(*) as msgs FROM messages GROUP BY session_id ORDER BY msgs DESC LIMIT 5;"
```

Expected: rows showing session IDs with message counts. Confirms LCM is capturing the develop session's full history.

---

## Rollback

If lossless-claw causes issues (session errors, gateway instability):

1. Remove `"slots"` block and `"lossless-claw"` entry from `openclaw.json`
2. `openclaw gateway stop && openclaw gateway install`
3. Sessions revert to default sliding-window compaction
4. `lcm.db` can be left in place — it is inert without the plugin active
