#!/usr/bin/env bash
#
# run-driver.sh — Auto-kick agent crons as steps become pending.
# Eliminates 5-min wait between steps, driving runs to completion in minutes.
#
# Usage:
#   bash run-driver.sh <run-id-prefix>
#   bash run-driver.sh <run-id-prefix> --poll-interval 3
#
set -euo pipefail

ANTFARM="node /Users/davidmini/.openclaw/workspace/antfarm/dist/cli/cli.js"
POLL_INTERVAL="${2:-5}"  # seconds between status checks

RUN_PREFIX="$1"
if [ -z "$RUN_PREFIX" ]; then
  echo "Usage: $0 <run-id-prefix> [--poll-interval N]"
  exit 1
fi

# Parse optional --poll-interval
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Resolve full run ID
FULL_RUN_ID=$($ANTFARM workflow status "$RUN_PREFIX" 2>&1 | grep "^Run:" | awk '{print $2}')
if [ -z "$FULL_RUN_ID" ]; then
  echo "ERROR: Could not find run matching prefix '$RUN_PREFIX'"
  exit 1
fi

echo "=== Run Driver ==="
echo "Run: $FULL_RUN_ID"
echo "Poll interval: ${POLL_INTERVAL}s"
echo ""

# Cache: map agent IDs to cron job IDs
declare -A CRON_MAP
refresh_cron_map() {
  CRON_MAP=()
  while IFS= read -r line; do
    local agent_id=$(echo "$line" | cut -d'|' -f1)
    local cron_id=$(echo "$line" | cut -d'|' -f2)
    CRON_MAP["$agent_id"]="$cron_id"
  done < <(openclaw cron list --json 2>/dev/null | python3 -c "
import sys, json
jobs = json.load(sys.stdin)['jobs']
for j in jobs:
    if j['agentId'].startswith('ai-developer-'):
        print(f\"{j['agentId']}|{j['id']}\")
")
  echo "Cron map loaded: ${#CRON_MAP[@]} agents"
}

refresh_cron_map

LAST_KICKED=""
KICK_COUNT=0

while true; do
  # Get current status
  STATUS_OUTPUT=$($ANTFARM workflow status "$RUN_PREFIX" 2>&1)

  RUN_STATUS=$(echo "$STATUS_OUTPUT" | grep "^Status:" | awk '{print $2}')

  if [ "$RUN_STATUS" = "completed" ]; then
    echo ""
    echo ">>> RUN COMPLETED <<<"
    echo "$STATUS_OUTPUT" | grep "^\[" || true
    exit 0
  fi

  if [ "$RUN_STATUS" = "failed" ] || [ "$RUN_STATUS" = "cancelled" ]; then
    echo ""
    echo ">>> RUN $RUN_STATUS <<<"
    echo "$STATUS_OUTPUT" | grep "^\[" || true
    exit 1
  fi

  # Find pending step and its agent
  PENDING_LINE=$(echo "$STATUS_OUTPUT" | grep "\[pending\]" | head -1)

  if [ -n "$PENDING_LINE" ]; then
    # Extract agent ID from parentheses: e.g., "(ai-developer-developer)"
    AGENT_ID=$(echo "$PENDING_LINE" | grep -o '([^)]*' | sed 's/(//')
    STEP_NAME=$(echo "$PENDING_LINE" | sed 's/.*\] //' | sed 's/ (.*//')

    # Only kick if we haven't already kicked this exact step
    KICK_KEY="${STEP_NAME}:${AGENT_ID}"
    if [ "$KICK_KEY" != "$LAST_KICKED" ]; then
      CRON_ID="${CRON_MAP[$AGENT_ID]:-}"

      if [ -z "$CRON_ID" ]; then
        # Crons may have regenerated, refresh
        refresh_cron_map
        CRON_ID="${CRON_MAP[$AGENT_ID]:-}"
      fi

      if [ -n "$CRON_ID" ]; then
        KICK_COUNT=$((KICK_COUNT + 1))
        echo "[$(date +%H:%M:%S)] Step $KICK_COUNT: Kicking $STEP_NAME ($AGENT_ID)"
        openclaw cron run "$CRON_ID" --timeout 600000 >/dev/null 2>&1 &
        LAST_KICKED="$KICK_KEY"
      else
        echo "[$(date +%H:%M:%S)] WARNING: No cron found for $AGENT_ID"
      fi
    fi
  fi

  # Show running steps
  RUNNING=$(echo "$STATUS_OUTPUT" | grep "\[running\]" | head -1)
  if [ -n "$RUNNING" ]; then
    STEP=$(echo "$RUNNING" | sed 's/.*\] //' | sed 's/ (.*//')
    printf "\r[$(date +%H:%M:%S)] Running: %-20s" "$STEP"
  fi

  sleep "$POLL_INTERVAL"
done
