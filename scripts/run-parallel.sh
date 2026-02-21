#!/usr/bin/env bash
# run-parallel.sh — Run multiple Antfarm tickets through the pipeline in parallel
#
# Usage: bash run-parallel.sh AMA-635 AMA-636 AMA-637
#        bash run-parallel.sh --poll-interval 5 AMA-635 AMA-636
#
# Starts all runs, then shepherds them through each step in parallel.
# Each step kick creates an isolated session that claims one pending step.

set -euo pipefail

ANTFARM_CLI="node $HOME/.openclaw/workspace/antfarm/dist/cli/cli.js"
POLL_INTERVAL=10  # seconds between status checks

# ─── Parse arguments ──────────────────────────────────────────────────
TICKETS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    *) TICKETS+=("$1"); shift ;;
  esac
done

if [[ ${#TICKETS[@]} -eq 0 ]]; then
  echo "Usage: $0 [--poll-interval N] TICKET_ID [TICKET_ID ...]"
  exit 1
fi

N=${#TICKETS[@]}
echo "═══════════════════════════════════════════════════"
echo "  Parallel Pipeline Runner — $N tickets"
echo "═══════════════════════════════════════════════════"
echo "  Tickets: ${TICKETS[*]}"
echo "  Poll interval: ${POLL_INTERVAL}s"
echo ""

# ─── Helper: get fresh cron IDs ──────────────────────────────────────
declare -A CRON_IDS
refresh_cron_ids() {
  local json
  json=$(openclaw cron list --json 2>/dev/null)
  CRON_IDS=()
  while IFS=$'\t' read -r id name; do
    case "$name" in
      *ticket_picker) CRON_IDS[ticket_picker]="$id" ;;
      *developer)     CRON_IDS[developer]="$id" ;;
      *auditor)       CRON_IDS[auditor]="$id" ;;
      *closer)        CRON_IDS[closer]="$id" ;;
    esac
  done < <(echo "$json" | python3 -c "
import json,sys
data = json.load(sys.stdin)
jobs = data if isinstance(data, list) else data.get('jobs', [])
for j in jobs:
    if 'ai-developer' in j.get('name',''):
        print(f\"{j['id']}\t{j['name']}\")
")
}

# ─── Helper: kick a cron N times in parallel ─────────────────────────
kick_cron() {
  local agent="$1"
  local times="$2"
  local timeout="${3:-600000}"
  local cron_id="${CRON_IDS[$agent]:-}"

  if [[ -z "$cron_id" ]]; then
    echo "  ⚠️  No cron ID for $agent — refreshing..."
    refresh_cron_ids
    cron_id="${CRON_IDS[$agent]:-}"
    if [[ -z "$cron_id" ]]; then
      echo "  ❌ Still no cron ID for $agent!"
      return 1
    fi
  fi

  echo "  🚀 Kicking $agent x$times (cron: ${cron_id:0:8}...)"
  for ((i=0; i<times; i++)); do
    openclaw cron run "$cron_id" --timeout "$timeout" &>/dev/null &
    sleep 1  # stagger by 1s to avoid peek/claim race
  done
}

# ─── Helper: get step statuses for all runs ──────────────────────────
declare -A RUN_IDS

get_step_status() {
  local run_id="$1"
  local step="$2"
  $ANTFARM_CLI workflow status "$run_id" 2>/dev/null | grep "\] $step " | awk '{print $1}' | tr -d '[]'
}

# Count how many runs have a given step in a given status
count_step_status() {
  local step="$1"
  local target_status="$2"
  local count=0
  for ticket in "${TICKETS[@]}"; do
    local rid="${RUN_IDS[$ticket]:-}"
    [[ -z "$rid" ]] && continue
    local status
    status=$(get_step_status "$rid" "$step")
    [[ "$status" == "$target_status" ]] && ((count++))
  done
  echo "$count"
}

# Count how many runs have a given step done
count_step_done() {
  count_step_status "$1" "done"
}

# Check if all runs completed (or failed)
all_runs_terminal() {
  for ticket in "${TICKETS[@]}"; do
    local rid="${RUN_IDS[$ticket]:-}"
    [[ -z "$rid" ]] && return 1
    local status
    status=$($ANTFARM_CLI workflow status "$rid" 2>/dev/null | grep "^Status:" | awk '{print $2}')
    case "$status" in
      completed|failed) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# Print a status summary
print_status() {
  echo ""
  echo "─── Status ──────────────────────────────────────"
  for ticket in "${TICKETS[@]}"; do
    local rid="${RUN_IDS[$ticket]:-}"
    [[ -z "$rid" ]] && { echo "  $ticket: no run"; continue; }
    local line
    line=$($ANTFARM_CLI workflow status "$rid" 2>/dev/null | grep -E "^\s*\[" | tr '\n' ' ')
    local overall
    overall=$($ANTFARM_CLI workflow status "$rid" 2>/dev/null | grep "^Status:" | awk '{print $2}')
    echo "  $ticket ($overall): $line"
  done
  echo "─────────────────────────────────────────────────"
}

# ─── Step 1: Start all runs ──────────────────────────────────────────
echo "▶ Starting $N runs..."
for ticket in "${TICKETS[@]}"; do
  output=$($ANTFARM_CLI workflow run ai-developer "$ticket" 2>&1)
  run_id=$(echo "$output" | grep "^Run:" | awk '{print $2}')
  RUN_IDS[$ticket]="$run_id"
  echo "  $ticket → ${run_id:0:8}"
done

# Wait a moment for DB to settle, then refresh cron IDs
sleep 2
refresh_cron_ids

# ─── Step 2: Pipeline loop ───────────────────────────────────────────
# Steps in order, with the agent that handles each
STEPS=("pick_ticket:ticket_picker" "develop:developer" "audit:auditor" "fix_and_pr:developer" "merge:closer")

for step_agent in "${STEPS[@]}"; do
  step="${step_agent%%:*}"
  agent="${step_agent##*:}"
  timeout=300000
  [[ "$agent" == "developer" ]] && timeout=600000

  echo ""
  echo "▶ Step: $step (agent: $agent)"

  # Wait until at least one run has this step pending
  while true; do
    pending=$(count_step_status "$step" "pending")
    done_count=$(count_step_done "$step")
    running=$(count_step_status "$step" "running")

    if [[ $pending -gt 0 ]]; then
      break
    fi

    if [[ $done_count -eq $N ]]; then
      echo "  ✅ All $N runs already done with $step"
      break
    fi

    # Check if all terminal
    if all_runs_terminal; then
      echo "  ⏹  All runs reached terminal state"
      break
    fi

    sleep "$POLL_INTERVAL"
  done

  # Kick for all pending
  pending=$(count_step_status "$step" "pending")
  if [[ $pending -gt 0 ]]; then
    # Refresh cron IDs (they may have changed)
    refresh_cron_ids
    kick_cron "$agent" "$pending" "$timeout"
  fi

  # Wait for all runs to complete this step
  while true; do
    done_count=$(count_step_done "$step")
    running=$(count_step_status "$step" "running")
    pending=$(count_step_status "$step" "pending")

    if [[ $done_count -eq $N ]]; then
      echo "  ✅ All $N runs completed $step"
      break
    fi

    # If some are still pending (not claimed), kick again
    if [[ $pending -gt 0 && $running -eq 0 ]]; then
      echo "  ⚠️  $pending still pending, re-kicking..."
      refresh_cron_ids
      kick_cron "$agent" "$pending" "$timeout"
    fi

    if all_runs_terminal; then
      echo "  ⏹  All runs reached terminal state"
      break
    fi

    sleep "$POLL_INTERVAL"
  done
done

# ─── Final Status ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  FINAL RESULTS"
echo "═══════════════════════════════════════════════════"
for ticket in "${TICKETS[@]}"; do
  rid="${RUN_IDS[$ticket]:-}"
  status=$($ANTFARM_CLI workflow status "$rid" 2>/dev/null | grep "^Status:" | awk '{print $2}')
  case "$status" in
    completed) echo "  ✅ $ticket — completed" ;;
    failed)    echo "  ❌ $ticket — failed" ;;
    *)         echo "  ⚠️  $ticket — $status" ;;
  esac
done
echo "═══════════════════════════════════════════════════"
