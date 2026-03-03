#!/usr/bin/env bash
# Load test: POST /worker/execute
# Simulates concurrent job submission with a sample Adobe operation payload.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3789}"
DURATION="${DURATION:-30}"
CONNECTIONS="${CONNECTIONS:-10}"
PIPELINING="${PIPELINING:-1}"

PAYLOAD='{"tool":"adobePhotoshop","action":"applyFilter","params":{"filter":"blur","radius":5},"requestedBy":"load-test"}'

echo "=== /worker/execute load test ==="
echo "URL:         $BASE_URL/worker/execute"
echo "Duration:    ${DURATION}s"
echo "Connections: $CONNECTIONS"
echo ""

npx --yes autocannon \
  -d "$DURATION" \
  -c "$CONNECTIONS" \
  -p "$PIPELINING" \
  -m POST \
  -H "Content-Type: application/json" \
  -b "$PAYLOAD" \
  "$BASE_URL/worker/execute"
