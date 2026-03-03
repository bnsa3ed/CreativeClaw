#!/usr/bin/env bash
# Load test: POST /worker/approve
# Simulates approval throughput with a dummy approval ID and actor.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3789}"
DURATION="${DURATION:-30}"
CONNECTIONS="${CONNECTIONS:-10}"
PIPELINING="${PIPELINING:-1}"

# actorId should match a reviewer/owner in your test team store
APPROVAL_ID="load-test-approval-$(date +%s)"
ACTOR_ID="${ACTOR_ID:-load-test-actor}"

echo "=== /worker/approve load test ==="
echo "URL:         $BASE_URL/worker/approve"
echo "Duration:    ${DURATION}s"
echo "Connections: $CONNECTIONS"
echo ""

npx --yes autocannon \
  -d "$DURATION" \
  -c "$CONNECTIONS" \
  -p "$PIPELINING" \
  -m POST \
  -H "Content-Type: application/json" \
  -b "{\"approvalId\":\"$APPROVAL_ID\",\"actorId\":\"$ACTOR_ID\"}" \
  "$BASE_URL/worker/approve"
