#!/bin/bash
# Start the Antfarm Gmail notification bridge as a background daemon
# Usage: bash notify-gmail-start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASSWORD_FILE="$HOME/.openclaw/gmail-app-password"
PID_FILE="/tmp/antfarm-notify-gmail.pid"
LOG_FILE="$HOME/.openclaw/antfarm/notify-gmail.log"

# Check for existing instance
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Already running (PID $(cat "$PID_FILE")). Stop with: kill $(cat "$PID_FILE")"
  exit 0
fi

# Check for app password
if [ ! -f "$PASSWORD_FILE" ]; then
  echo "Missing Gmail App Password file: $PASSWORD_FILE"
  echo ""
  echo "Setup:"
  echo "  1. Go to https://myaccount.google.com/apppasswords"
  echo "  2. Generate an App Password for 'Mail'"
  echo "  3. Save it: echo 'xxxx xxxx xxxx xxxx' > $PASSWORD_FILE && chmod 600 $PASSWORD_FILE"
  exit 1
fi

export GMAIL_USER="openclawjoshua@gmail.com"
export GMAIL_APP_PASSWORD="$(tr -d '\n' < "$PASSWORD_FILE")"

mkdir -p "$(dirname "$LOG_FILE")"

nohup node "$SCRIPT_DIR/notify-gmail.js" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Antfarm Gmail bridge started (PID $!)"
echo "Log: $LOG_FILE"
echo "Stop: kill $!"
