#!/usr/bin/env bash
# Full load test suite — runs all endpoint tests sequentially.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export BASE_URL="${BASE_URL:-http://127.0.0.1:3789}"
export DURATION="${DURATION:-30}"
export CONNECTIONS="${CONNECTIONS:-10}"

echo "╔══════════════════════════════════════════╗"
echo "║   CreativeClaw Full Load Test Suite       ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Base URL:   $BASE_URL"
echo "║  Duration:   ${DURATION}s per endpoint"
echo "║  Conns:      $CONNECTIONS"
echo "╚══════════════════════════════════════════╝"
echo ""

bash "$SCRIPT_DIR/execute.sh"
echo ""
bash "$SCRIPT_DIR/approve.sh"
echo ""
bash "$SCRIPT_DIR/team-users.sh"

echo ""
echo "✅ Full suite complete."
