#!/usr/bin/env bash
# Load test: GET /team/users
# Read-heavy test simulating team list queries from dashboard / Telegram bot.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3789}"
DURATION="${DURATION:-30}"
CONNECTIONS="${CONNECTIONS:-20}"
PIPELINING="${PIPELINING:-4}"

echo "=== /team/users load test ==="
echo "URL:         $BASE_URL/team/users"
echo "Duration:    ${DURATION}s"
echo "Connections: $CONNECTIONS"
echo "Pipelining:  $PIPELINING"
echo ""

npx --yes autocannon \
  -d "$DURATION" \
  -c "$CONNECTIONS" \
  -p "$PIPELINING" \
  -m GET \
  "$BASE_URL/team/users"
