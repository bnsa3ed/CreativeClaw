# CreativeClaw

**AI agent for creative professionals** — control Premiere Pro, After Effects, Photoshop, and Illustrator through natural language, Telegram, or the CLI, with authenticated API access, approval-gated execution, persistent memory, team RBAC, job scheduling, and a live operations dashboard.

> Version **0.8.0** · Node 22 · TypeScript ESM · pnpm monorepo

---

## What it does

- **Natural language control** — type *"trim clip intro from 5s to 30s"* in Telegram; Claude parses it and fires the right Adobe operation automatically
- **Real Adobe execution** — ExtendScript dispatched into live Premiere, After Effects, Photoshop, or Illustrator via the local worker bridge or CEP companion panel
- **API authentication** — every gateway endpoint is protected by Bearer API keys, SQLite-managed with labels and rotation; auto-generates a key on first run
- **Approval gates** — high-risk operations pause for human review; any `reviewer` or `owner` approves via `/approve <id>` in Telegram or the CLI
- **Team RBAC** — roles (`owner`, `editor`, `reviewer`, `viewer`) enforced on every operation, approval, and API call
- **Job scheduler** — cron, interval, and one-shot scheduled operations with optional webhook callbacks on completion
- **Asset browser** — query what's currently open in any Adobe app; list all clips, layers, and documents
- **Style memory** — learns your editing patterns per project (weighted confidence, approval signals), persisted to SQLite
- **CEP companion panel** — installable Adobe extension for direct bidirectional ExtendScript without osascript (also works on Windows)
- **Full CLI** — `creativeclaw execute`, `jobs`, `approve`, `team`, `schedule`, `auth`, `memory`, `run` (NLP) — all from the terminal
- **Live dashboard** — dark-mode web UI at `:3790` covering workers, approvals, scheduler, auth keys, assets, job history, memory profiles, and Prometheus metrics — auto-refreshes every 5 s
- **One-command deploy** — Docker Compose, Fly.io, or systemd

---

## Architecture

```
creativeclaw/
├── apps/
│   ├── gateway/          # HTTP control plane + WebSocket bridge (port 3789)
│   ├── dashboard/        # Live dark-mode operations dashboard (port 3790)
│   ├── cli/              # Full CLI — execute, jobs, team, schedule, auth, NLP
│   └── worker-local/     # Desktop worker — bridges gateway ↔ Adobe apps
├── packages/
│   ├── auth/             # API key management + Bearer auth middleware
│   ├── ai/               # NLP router (Claude) + rule-based fallback + conversation memory
│   ├── telegram/         # Bot client — polling, webhook, signature verification, command router
│   ├── scheduler/        # SQLite cron/interval/one-shot scheduler + webhook callbacks
│   ├── connectors-adobe/ # ExtendScript generator, osascript bridge, asset browser
│   ├── jobs/             # SQLite job queue + paginated operation history
│   ├── memory/           # Style learning engine + SQLite vector store + project profiles
│   ├── collaboration/    # Team user store + RBAC
│   ├── errors/           # Typed error codes + factory functions
│   ├── core/             # Config, shared types, data dir
│   ├── action-executor/  # Sandboxed JS runner + gateway HTTP dispatch
│   ├── observability/    # Event bus + counters
│   ├── protocol/         # WebSocket message types
│   ├── tool-registry/    # MCP-style progressive tool discovery
│   ├── api-registry/     # External API credential store
│   └── search/           # Brave search client
├── cep-extension/        # Adobe CEP panel — bidirectional ExtendScript via WebSocket
├── load-tests/           # autocannon scripts for key endpoints
├── docs/runbook.md       # Error catalog + operational procedures
├── scripts/              # security-check.sh, install.sh
├── systemd/              # Linux systemd service unit
├── Dockerfile            # Multi-stage production image
├── docker-compose.yml    # Gateway + dashboard stack
└── fly.toml              # Fly.io deployment config
```

---

## Quick Start

### One-line install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/bnsa3ed/CreativeClaw/main/scripts/install.sh | bash
```

### Manual

```bash
git clone https://github.com/bnsa3ed/CreativeClaw.git
cd CreativeClaw
cp .env.example .env    # fill in TELEGRAM_BOT_TOKEN + CREATIVECLAW_OWNER_ID
pnpm install
pnpm build
```

### Run (development)

```bash
# Terminal 1 — Gateway
node dist/apps/gateway/src/index.js
# Prints a generated API key on first run if none is configured

# Terminal 2 — Dashboard
node dist/apps/dashboard/src/index.js
# → http://127.0.0.1:3790

# Terminal 3 — Local Adobe worker (on your desktop, with Adobe open)
CREATIVECLAW_API_KEY=<key> node dist/apps/worker-local/src/index.js

# Terminal 4 — CLI
export CREATIVECLAW_API_KEY=<key>
node dist/apps/cli/src/index.js status
node dist/apps/cli/src/index.js doctor
```

### Docker

```bash
cp .env.example .env
docker compose up -d
# Gateway:   http://localhost:3789
# Dashboard: http://localhost:3790
```

### Fly.io

```bash
fly launch
fly secrets set TELEGRAM_BOT_TOKEN=... CREATIVECLAW_OWNER_ID=... CREATIVECLAW_API_KEY=...
fly deploy
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `CREATIVECLAW_OWNER_ID` | ✅ | Telegram user ID seeded as initial team owner |
| `CREATIVECLAW_API_KEY` | ✅ | Master API key (auto-generated and printed on first run if missing) |
| `ANTHROPIC_API_KEY` | recommended | Enables Claude NLP — without it, rule-based fallback only |
| `CREATIVECLAW_PUBLIC_URL` | — | Public gateway URL for Telegram webhook registration; falls back to polling if unset |
| `TELEGRAM_WEBHOOK_SECRET` | — | HMAC secret for webhook verification (auto-generated if unset) |
| `CREATIVECLAW_ADOBE_MOCK` | — | `true` to simulate Adobe ops without a running app (default in Docker/CI) |
| `BRAVE_SEARCH_API_KEY` | — | Enables `/search` endpoint |
| `CREATIVECLAW_GATEWAY` | — | Override gateway URL used by CLI (default `http://127.0.0.1:3789`) |
| `CREATIVECLAW_DASHBOARD_PORT` | — | Dashboard port (default `3790`) |
| `CREATIVECLAW_DASHBOARD_REFRESH` | — | Dashboard refresh interval ms (default `5000`) |

---

## Authentication

Every gateway endpoint (except `/health`, `/metrics`, `/telegram/inbound`) requires:

```
Authorization: Bearer <api-key>
```

or

```
X-API-Key: <api-key>
```

**On first run** with no keys configured and no `CREATIVECLAW_API_KEY` env var, the gateway auto-generates a default key and prints it to stdout. Add it to your `.env`.

### Key management

```bash
# CLI
creativeclaw auth keys                        # list keys
creativeclaw auth keys add --label "my-key"   # create key (shown once)
creativeclaw auth keys revoke <id>            # revoke key

# API
GET    /auth/keys          # list keys
POST   /auth/keys          # { "label": "..." } → returns key plaintext once
DELETE /auth/keys/:id      # revoke
```

---

## Natural Language (NLP)

With `ANTHROPIC_API_KEY` set, the gateway routes natural language through Claude to identify and execute the right Adobe operation.

**Via Telegram** — just type naturally (no slash command needed):
```
trim clip intro from 5s to 30s
resize to 1920x1080
replace text "Draft" with "Final"
export to /tmp/output.mp4
apply lut Kodak2383 to background layer
```

**Via API:**
```bash
curl -X POST http://localhost:3789/ai/run \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{ "text": "trim clip intro from 5s to 30s", "workerId": "worker_123" }'
```

**Via CLI:**
```bash
creativeclaw run "trim clip intro from 5s to 30s"
```

Without `ANTHROPIC_API_KEY`, a rule-based parser handles common patterns (trim, resize, replace text, apply LUT, export, delete).

---

## Adobe Bridge

### Option A — Local worker (macOS)

The `worker-local` app connects to the gateway via WebSocket and executes ExtendScript via `osascript`. Requires macOS and the target Adobe app to be open.

```bash
CREATIVECLAW_API_KEY=<key> node dist/apps/worker-local/src/index.js
```

### Option B — CEP companion panel (macOS + Windows)

Install the CEP extension into each Adobe app for direct bidirectional ExtendScript via WebSocket — no osascript, works on Windows, supports event callbacks from Adobe.

```bash
# 1. Download CSInterface.js (required, Adobe-licensed)
curl -o cep-extension/js/CSInterface.js \
  https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js

# 2. Enable unsigned extensions (dev mode)
defaults write com.adobe.CSXS.11 PlayerDebugMode 1   # macOS

# 3. Install
cp -r cep-extension ~/Library/Application\ Support/Adobe/CEP/extensions/com.creativeclaw.bridge

# 4. Restart Adobe → Window → Extensions → CreativeClaw Bridge
```

See [`cep-extension/README.md`](cep-extension/README.md) for full install instructions and Windows paths.

### Supported operations

| App | Operation | Required fields | Risk |
|-----|-----------|----------------|------|
| Premiere Pro | `trim_clip` | `clipId`, `in`, `out` | medium |
| Premiere Pro | `insert_clip` | `assetPath`, `track`, `timecode` | low |
| Premiere Pro | `delete_clip` | `clipId` | **high** |
| Premiere Pro | `export_sequence` | `outputPath` | low |
| After Effects | `add_keyframe` | `layer`, `property`, `time`, `value` | medium |
| After Effects | `render_comp` | `outputPath` | medium |
| After Effects | `delete_layer` | `layer` | **high** |
| Photoshop | `apply_lut` | `layer`, `lutName` | low |
| Photoshop | `apply_curves` | `channel`, `points` | low |
| Photoshop | `resize` | `width`, `height` | medium |
| Photoshop | `export` | `outputPath` | low |
| Illustrator | `replace_text` | `textObject`, `value` | low |
| Illustrator | `export` | `outputPath` | low |

High-risk operations always require approval from a `reviewer` or `owner` before executing.

---

## CLI Reference

```bash
# Set up
export CREATIVECLAW_API_KEY=<your-key>
export CREATIVECLAW_GATEWAY=http://127.0.0.1:3789  # optional

# Gateway
creativeclaw status                          # health + uptime
creativeclaw doctor                          # local diagnostics
creativeclaw config                          # show resolved config
creativeclaw workers                         # list connected workers
creativeclaw assets [--app premiere]         # browse open project assets

# Execute operations
creativeclaw execute premiere trim_clip \
  --payload '{"clipId":"intro","in":"5","out":"30"}' \
  --webhook https://my-app.com/hook

# Natural language (NLP)
creativeclaw run "trim clip intro from 5s to 30s"
creativeclaw run "resize to 1920x1080" --webhook https://my-app.com/hook

# Jobs
creativeclaw jobs                            # active queue
creativeclaw jobs history --limit 20         # paginated history
creativeclaw jobs ops                        # operation execution log
creativeclaw jobs stats                      # counts by status/risk
creativeclaw jobs add --name "export" --risk low
creativeclaw jobs run

# Approvals
creativeclaw approvals                       # list pending
creativeclaw approve <approvalId> --actor <userId>

# Team
creativeclaw team                            # list members
creativeclaw team add --user 123456 --role reviewer
creativeclaw team remove --user 123456

# Scheduler
creativeclaw schedule                        # list scheduled jobs
creativeclaw schedule add \
  --label "Nightly export" \
  --kind cron --expr "0 2 * * *" \
  --app premiere --op export_sequence \
  --payload '{"outputPath":"/exports/nightly.mp4"}' \
  --webhook https://my-app.com/hook
creativeclaw schedule toggle <id>           # enable/disable
creativeclaw schedule remove <id>

# Auth keys
creativeclaw auth keys
creativeclaw auth keys add --label "CI key"
creativeclaw auth keys revoke <id>

# Memory
creativeclaw memory profiles
creativeclaw memory profile --project my-project
creativeclaw memory stats
```

---

## API Reference

All endpoints require `Authorization: Bearer <key>` except `/health`, `/metrics`, `/telegram/inbound`.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/keys` | List API keys (no secrets) |
| `POST` | `/auth/keys` | Create key `{ label }` — returns plaintext once |
| `DELETE` | `/auth/keys/:id` | Revoke a key |

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness + uptime + worker count |
| `GET` | `/metrics` | Prometheus counters |
| `GET` | `/events` | Recent event bus entries |
| `GET` | `/tools` | Registered tool definitions |
| `GET` | `/search?q=` | Brave web search |

### NLP

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ai/run` | `{ text, workerId?, webhookUrl? }` → parse + execute |

### Workers & Adobe

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workers` | Connected workers + idle time |
| `POST` | `/worker/execute` | Dispatch operation (params: `workerId`, `app`, `operation`, `webhookUrl?`) |
| `GET` | `/worker/approvals` | Pending high-risk approvals |
| `POST` | `/worker/approve` | Approve (params: `approvalId`, `actorId`, `webhookUrl?`) |
| `GET` | `/connectors/health` | Adobe app running status |
| `GET` | `/assets?app=` | Open project assets (all apps or one) |

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | Active queue |
| `GET` | `/jobs/history` | Paginated history (`limit`, `offset`, `status`) |
| `GET` | `/jobs/operations` | Paginated operation log (`limit`, `offset`) |
| `GET` | `/jobs/stats` | Counts by status + risk |
| `POST` | `/jobs/add` | Add job (params: `name`, `risk`) |
| `POST` | `/jobs/run` | Run next queued job |

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scheduler/jobs` | All scheduled jobs |
| `POST` | `/scheduler/jobs` | Create job `{ label, kind, schedule, app, operation, payload?, webhookUrl? }` |
| `PATCH` | `/scheduler/jobs/:id` | Update job (patch any field) |
| `DELETE` | `/scheduler/jobs/:id` | Remove job |

Schedule kinds:
- `cron` — standard 5-field cron expression (e.g. `"0 2 * * *"` for 2 AM daily)
- `interval` — milliseconds between runs (e.g. `"3600000"` for every hour)
- `once` — Unix timestamp ms (e.g. `"1735689600000"`)

### Memory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/memory/profiles` | All project profiles |
| `GET` | `/memory/profile?projectId=` | Single project profile + recent signals |
| `GET` | `/memory/stats` | Total signals, projects, vector records |
| `POST` | `/memory/remember` | Record a style signal |

### Team

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/team/users` | List members + roles |
| `POST` | `/team/users` | Add/update `{ userId, role }` |
| `DELETE` | `/team/users?userId=` | Remove member |

---

## Telegram

### Setup

The bot connects in two modes:
- **Polling** (default, no server required) — just set `TELEGRAM_BOT_TOKEN` and run
- **Webhook** — set `CREATIVECLAW_PUBLIC_URL` to your public gateway URL; the bot registers itself automatically on startup

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Introduction + quick tips |
| `/help` | Full command reference |
| `/status` | Gateway health + workers + NLP mode |
| `/workers` | Connected workers + capabilities |
| `/jobs` | Last 10 jobs with status |
| `/assets` | Scan all open Adobe projects |
| `/approve <id>` | Approve a pending high-risk operation |
| `/clear` | Clear conversation history |
| *(any text)* | Natural language — parsed by Claude and executed |

---

## Team Roles

| Role | Execute ops | Approve high-risk | Manage team |
|------|-------------|-------------------|-------------|
| `owner` | ✅ | ✅ | ✅ |
| `reviewer` | ✅ | ✅ | — |
| `editor` | ✅ | — | — |
| `viewer` | — | — | — |

The initial owner is seeded from `CREATIVECLAW_OWNER_ID` on first run.

---

## Job Scheduler

Schedule recurring Adobe operations without any extra infra:

```bash
# Export every weeknight at 2 AM
creativeclaw schedule add \
  --label "Nightly export" \
  --kind cron --expr "0 2 * * 1-5" \
  --app premiere --op export_sequence \
  --payload '{"outputPath":"/exports/latest.mp4"}'

# Check render queue every 30 minutes
creativeclaw schedule add \
  --label "Render poll" \
  --kind interval --expr "1800000" \
  --app aftereffects --op render_comp \
  --payload '{"outputPath":"/renders/latest.mp4"}' \
  --webhook https://my-app.com/render-done
```

Each scheduled job can include a `webhookUrl` — CreativeClaw POSTs the result JSON there when the job completes.

---

## Webhook Callbacks

Any operation or scheduled job can POST its result to a URL of your choice when it completes:

```bash
# One-off operation with callback
creativeclaw execute photoshop export \
  --payload '{"outputPath":"/out/hero.jpg","format":"jpeg"}' \
  --webhook https://my-app.com/export-done

# Approval with callback
creativeclaw approve abc123 --actor 999 \
  --webhook https://my-app.com/approved
```

Webhook payload:
```json
{
  "app": "photoshop",
  "operation": "export",
  "payload": { "outputPath": "/out/hero.jpg" },
  "result": { "ok": true, "executionMode": "real" },
  "durationMs": 1240,
  "timestamp": 1735689600000
}
```

---

## Dashboard

The dashboard at `:3790` auto-refreshes every 5 s and shows:

| Section | Content |
|---------|---------|
| Stat cards | Jobs total/done/failed, pending approvals, workers, memory signals, active schedules, API keys |
| Adobe Connectors | Running status + execution mode per app |
| Connected Workers | Capabilities + idle time |
| Pending Approvals | Full context for quick reviewer action |
| Team Members | Roles + join timestamps |
| Operation History | Last 25 ops — app, operation, status, mode, duration, error |
| Job Queue History | Last 30 jobs — status, risk, attempts, errors |
| Scheduled Jobs | All schedules — kind, expr, next run, run count |
| API Keys | Labels, IDs, last-used timestamps |
| Open Adobe Assets | Live asset list from all running Adobe apps |
| Style Memory Profiles | Per-project signal counts, confidence, top edit types |
| Event Counters | All gateway events |
| Prometheus Metrics | Raw text block |

---

## Error Catalog

All API errors return:
```json
{ "error": "ERR_FORBIDDEN", "message": "...", "details": {} }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `ERR_FORBIDDEN` | 403 | RBAC role insufficient |
| `ERR_NOT_FOUND` | 404 | Resource not found |
| `ERR_VALIDATION` | 400 | Payload schema failure |
| `ERR_APPROVAL_REQUIRED` | 202 | High-risk op queued for approval |
| `ERR_WORKER_TIMEOUT` | 504 | Worker didn't respond in 7 s |
| `ERR_WORKER_BAD_RESPONSE` | 502 | Malformed worker response |
| `ERR_APPROVAL_CONFLICT` | 409 | Duplicate pending approval |
| `ERR_APPROVAL_INVALID` | 400 | Approval ID expired or invalid |
| `ERR_BRIDGE_UNAVAILABLE` | 503 | No Adobe worker connected |
| `ERR_ADOBE_OPERATION` | 500 | Adobe app returned an error |
| `ERR_RATE_LIMIT` | 429 | Too many requests |
| `ERR_INTERNAL` | 500 | Unexpected server error |

See [`docs/runbook.md`](docs/runbook.md) for per-error causes, resolution steps, and operational commands.

---

## Load Testing

```bash
# Gateway must be running
bash load-tests/execute.sh       # POST /worker/execute
bash load-tests/approve.sh       # POST /worker/approve
bash load-tests/team-users.sh    # GET /team/users
bash load-tests/full-suite.sh    # All three sequentially
```

Overrides: `BASE_URL`, `DURATION` (secs), `CONNECTIONS`.

---

## Security

```bash
bash scripts/security-check.sh
```

Checks: hardcoded secrets, `.env` not git-tracked, debug endpoints, `.gitignore` coverage, TypeScript strict mode, `pnpm audit`. CI runs this on every push.

---

## Testing

```bash
pnpm build
pnpm test                                     # all workspace unit tests
bash tests/smoke.sh                           # gateway smoke
node tests/phase3-checks.mjs                  # style learning + vector
node tests/integration-gateway-worker.mjs     # full gateway ↔ worker flow
```

---

## Deployment

### Docker Compose
```bash
cp .env.example .env
docker compose up -d
docker compose logs -f gateway
```

### Fly.io
```bash
fly launch
fly secrets set TELEGRAM_BOT_TOKEN=... CREATIVECLAW_OWNER_ID=... CREATIVECLAW_API_KEY=...
fly deploy
```

### systemd (Linux VPS)
```bash
sudo cp systemd/creativeclaw-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now creativeclaw-gateway
sudo journalctl -u creativeclaw-gateway -f
```

---

## Roadmap

| Phase | What shipped |
|-------|-------------|
| 1 | Telegram loop, Brave search, API registry, SQLite job queue |
| 2 | Adobe WebSocket bridge, worker protocol, operation schemas, risk classification |
| 3 | Style learning engine, vector memory abstraction, observability, Prometheus metrics |
| 4 | Dashboard skeleton, integration tests, smoke tests |
| 5 | Team RBAC, role-gated approvals, Telegram `/approve` |
| 6 | Load tests, typed error catalog, runbook, security-check, CI workflow |
| 7 | Real Adobe bridge — ExtendScript generator, osascript execution, 13 ops across 4 apps |
| 8 | Persistent memory — SQLite vector store, style signals, project profiles, operation log |
| 9 | Full dashboard — dark-mode UI, 8 stat cards, 7 data tables, auto-refresh |
| 10 | Deployment — Dockerfile, docker-compose, Fly.io, systemd, install script, graceful shutdown |
| 11 | **Auth** — API key management, Bearer middleware, auto-generated default key |
| 11 | **NLP** — Claude-powered natural language → operation mapping, rule-based fallback |
| 11 | **Telegram** — proper bot client, polling + webhook, signature verification, conversation memory |
| 11 | **CLI** — execute, jobs, approve, team, schedule, auth, memory, NLP run commands |
| 11 | **Scheduler** — cron/interval/one-shot with SQLite persistence and webhook callbacks |
| 11 | **Asset browser** — live asset listing from all open Adobe projects |
| 11 | **CEP extension** — Adobe panel for bidirectional ExtendScript (macOS + Windows) |
| 11 | **Action executor** — wired to gateway HTTP dispatch + NLP endpoint |
| 11 | **Webhook callbacks** — any operation or scheduled job can POST results to a URL |
| 11 | **Project isolation** — `X-Project-ID` header scopes memory and job queries per project |

---

## License

MIT

---

## Acknowledgements

CreativeClaw is inspired by production patterns from modern AI agent systems and OpenClaw-style operational design (gateway lifecycle, policy-first execution, health/doctor workflows).
