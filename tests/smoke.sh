#!/usr/bin/env bash
set -euo pipefail
npm run build >/tmp/creativeclaw_build.log 2>&1
node dist/apps/cli/src/index.js status >/tmp/creativeclaw_cli_status.json
node dist/apps/gateway/src/index.js >/tmp/creativeclaw_gateway.log 2>&1 &
PID=$!
sleep 1
curl -sf http://127.0.0.1:3789/health >/tmp/creativeclaw_health.json
kill $PID || true
echo "SMOKE_OK"
