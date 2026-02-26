#!/bin/bash
# mini-develop.sh — Wrapper that runs mini-agent for a coding ticket
# Usage: mini-develop.sh <ticket_id> <repo> <branch_prefix>
# Reads TASK.md from /tmp/<ticket_id>-work/TASK.md (must be written before calling)
# Outputs antfarm KEY: value on success, STATUS: fail on error.
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.volta/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

TICKET_ID="$1"
REPO="$2"
BRANCH="${3:-feature/${TICKET_ID}}"

WORK_DIR="/tmp/${TICKET_ID}-work"
REPO_DIR="${WORK_DIR}/repo"
LOG_FILE="${WORK_DIR}/mini-agent.log"
PID_FILE="${WORK_DIR}/mini-agent.pid"
DONE_FILE="${WORK_DIR}/mini-agent.done"

# ── 1. Verify TASK.md exists ────────────────────────────────────────────────
if [ ! -f "${WORK_DIR}/TASK.md" ]; then
  echo "STATUS: fail"
  echo "ERROR: TASK.md not found at ${WORK_DIR}/TASK.md"
  exit 1
fi

# ── 2. Clone repo ────────────────────────────────────────────────────────────
rm -rf "$REPO_DIR"
git clone "https://github.com/${REPO}.git" "$REPO_DIR"
cd "$REPO_DIR"
BASE_BRANCH=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')
BASE_BRANCH="${BASE_BRANCH:-main}"
git checkout "$BASE_BRANCH" && git pull origin "$BASE_BRANCH"

# ── 3. Pre-run tests on main (capture baseline state for mini-agent) ──────────
{
  printf '\n## Current Test State\n\n'
  printf "These tests ran on \`$BASE_BRANCH\` before your branch was created.\n"
  printf 'Keep all currently-passing tests green. Fix pre-existing failures only if the ticket requires it.\n\n'
  printf '```\n'
  if ls build.gradle build.gradle.kts settings.gradle settings.gradle.kts >/dev/null 2>&1; then
    echo "Android/Kotlin — Gradle requires JDK 17 (not available here). CI will run tests on push."
  elif [ -f "package.json" ]; then
    (set +e; timeout 60 npm ci --quiet >/dev/null 2>&1; timeout 60 npm install --quiet >/dev/null 2>&1; true)
    (set +e; timeout 300 npm test 2>&1; true) | tail -80
  elif [ -f "pytest.ini" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
    (set +e; timeout 60 pip install -r requirements.txt -q >/dev/null 2>&1; true)
    (set +e; timeout 60 pip install -e ".[dev]" -q >/dev/null 2>&1; true)
    (set +e; timeout 300 pytest --tb=short -v 2>&1; true) | tail -80
  else
    echo "No recognized test framework detected."
  fi
  printf '```\n'
} >> "${WORK_DIR}/TASK.md" 2>&1 || true

# ── 4. Create feature branch ─────────────────────────────────────────────────
git checkout -B "$BRANCH"

# ── 5. Copy TASK.md (now includes test baseline) into workspace ───────────────
cp "${WORK_DIR}/TASK.md" "${REPO_DIR}/TASK.md"

# ── 6. Launch mini-agent in background ───────────────────────────────────────
TASK_MSG="Read TASK.md at the root of your workspace. It contains a ticket to implement.

Your job:
1. Read TASK.md carefully — it describes what needs to be implemented.
2. Explore the existing codebase to understand the patterns and conventions.
3. Implement the changes described in TASK.md. Make minimal, targeted changes — only touch code directly related to the acceptance criteria. Do not refactor unrelated code.
4. Make sure any available tests pass before committing.
5. Commit all changes with message: 'feat: ${TICKET_ID} implementation'
6. Remove TASK.md from the repo before committing (it should not be committed).
7. Do NOT create a Pull Request — just commit and the wrapper will push.

When done, write a short completion note to SESSION_RESULT.txt:
  BRANCH: ${BRANCH}
  FILES: <comma-separated list of changed files>
  SUMMARY: <one-line summary of what was implemented>"

nohup mini-agent \
  --task "$TASK_MSG" \
  --workspace "$REPO_DIR" \
  > "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "mini-agent started with PID $(cat $PID_FILE)" >&2

# ── 6. Wait for mini-agent to complete (check every 60s) ─────────────────────
PID=$(cat "$PID_FILE")
ELAPSED=0
MAX_WAIT=14400  # 4 hours max

while kill -0 "$PID" 2>/dev/null; do
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    kill "$PID" 2>/dev/null || true
    echo "STATUS: fail"
    echo "ERROR: mini-agent timed out after ${MAX_WAIT}s"
    exit 1
  fi
  sleep 60
  ELAPSED=$((ELAPSED + 60))
done

# ── 7. Validate: must have at least one commit ahead of main ──────────────────
cd "$REPO_DIR"
COMMITS=$(git rev-list --count "$BASE_BRANCH"..HEAD 2>/dev/null || echo "0")
if [ "$COMMITS" -eq 0 ]; then
  echo "STATUS: fail"
  echo "ERROR: mini-agent produced no commits. Log tail:"
  tail -30 "$LOG_FILE" >&2
  exit 1
fi

# Remove TASK.md if mini-agent forgot
if git ls-files TASK.md | grep -q TASK.md 2>/dev/null; then
  git rm -f TASK.md 2>/dev/null && git commit --amend --no-edit 2>/dev/null || true
fi

# ── 8. Push branch ───────────────────────────────────────────────────────────
git push --force-with-lease -u origin "$BRANCH"

# ── 9. Collect results from git state ────────────────────────────────────────
ACTUAL_BRANCH=$(git branch --show-current)
REPO_REMOTE=$(git remote get-url origin | sed 's|.*github\.com/||' | sed 's|\.git$||')
FILES=$(git diff --name-only "origin/$BASE_BRANCH"...HEAD | tr '\n' ',' | sed 's/,$//')

# ── 10. Output antfarm step result ───────────────────────────────────────────
echo "STATUS: done"
echo "BRANCH_NAME: ${ACTUAL_BRANCH}"
echo "CHANGED_FILES: ${FILES}"
echo "REPO_NAME: ${REPO_REMOTE}"
echo "BASE_BRANCH: ${BASE_BRANCH}"
