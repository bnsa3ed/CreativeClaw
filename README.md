# CreativeClaw

**AI agent for creative professionals** — control Premiere Pro, After Effects, Photoshop, and Illustrator via Telegram, with approval-gated execution, persistent memory, team RBAC, and a live operations dashboard.

> Version **0.7.0** · Node 22 · TypeScript ESM · pnpm monorepo

---

## What it does

- **Talk to Adobe apps** — send Telegram commands like `/run-job trim_clip` and CreativeClaw dispatches real ExtendScript into the open app via a local worker bridge
- **Approval gates** — high-risk operations (delete, export) pause for human review; any `reviewer` or `owner` on the team approves via `/approve <id>` in Telegram
- **Team RBAC** — roles (`owner`, `editor`, `reviewer`, `viewer`) enforced on every operation and approval
- **Style memory** — learns your editing patterns per project (weighted confidence, approval signals), persisted to SQLite
- **Live dashboard** — dark-mode web UI at `:3790` showing workers, jobs, approvals, connectors, memory profiles, and metrics — auto-refreshes every 5 s
- **Prometheus metrics** — `/metrics` endpoint ready for Grafana
- **One-command deploy** — Docker Compose, Fly.io, or systemd

---

## Architecture

```
creativeclaw/
├── apps/
│   ├── gateway/          # HTTP control plane + WebSocket bridge (port 3789)
│   ├── dashboard/        # Live dark-mode operations dashboard (port 3790)
│   ├── cli/              # creativeclaw CLI (status, doctor, config, api)
│   └── worker-local/     # Desktop worker — bridges gateway to Adobe apps
├── packages/
│   ├── core/             # Config, shared types, data dir
│   ├── errors/           # Typed error catalog + factory functions
│   ├── jobs/             # SQLite job queue + operation history log
│   ├── memory/           # Style learning engine + SQLite vector store
│   ├── connectors-adobe/ # ExtendScript generator + macOS osascript bridge
│   ├── collaboration/    # Team user store + RBAC (SQLite)
│   ├── observability/    # Event bus + counters
│   ├── protocol/         # WebSocket message types
│   ├── tool-registry/    # MCP-style progressive tool discovery
│   ├── action-executor/  # Sandboxed action runtime
│   ├── api-registry/     # External API credential store
│   └── search/           # Brave search client
├── load-tests/           # autocannon load test scripts
├── docs/runbook.md       # Error catalog + operational procedures
├── scripts/              # security-check.sh, install.sh
├── systemd/              # Linux service unit
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

**Prerequisites:** Node.js 22+, pnpm (or npm), git

```bash
git clone https://github.com/bnsa3ed/CreativeClaw.git
cd CreativeClaw
cp .env.example .env          # fill in your tokens
pnpm install
pnpm build
```

### Run (development)

```bash
# 1. Gateway (control plane)
node dist/apps/gateway/src/index.js
# -> http://127.0.0.1:3789

# 2. Dashboard
node dist/apps/dashboard/src/index.js
# -> http://127.0.0.1:3790

# 3. Local Adobe worker (on your desktop, alongside Adobe)
node dist/apps/worker-local/src/index.js

# 4. CLI
node dist/apps/cli/src/index.js status
node dist/apps/cli/src/index.js doctor
```

### Docker (recommended for servers)

```bash
cp .env.example .env   # fill in tokens
docker compose up -d
# Gateway:   http://localhost:3789
# Dashboard: http://localhost:3790
```

### Fly.io

```bash
fly launch   # first time
fly deploy   # subsequent
```

---

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `CREATIVECLAW_OWNER_ID` | ✅ | Telegram user ID of the initial owner |
| `CREATIVECLAW_ADOBE_MOCK` | — | `true` to simulate Adobe (default in Docker/CI) |
| `BRAVE_SEARCH_API_KEY` | — | Enables `/search` endpoint |
| `GATEWAY_PORT` | — | Gateway port (default `3789`) |
| `CREATIVECLAW_DASHBOARD_PORT` | — | Dashboard port (default `3790`) |
| `CREATIVECLAW_DASHBOARD_REFRESH` | — | Dashboard auto-refresh ms (default `5000`) |

---

## Adobe Bridge

The local worker (`worker-local`) connects to the gateway via WebSocket and dispatches **real ExtendScript** into open Adobe apps via `osascript` on macOS.

### Supported operations

| App | Operation | Fields | Risk |
|-----|-----------|--------|------|
| Premiere Pro | `trim_clip` | `clipId`, `in`, `out` | medium |
| Premiere Pro | `insert_clip` | `assetPath`, `track`, `timecode` | low |
| Premiere Pro | `delete_clip` | `clipId` | **high** |
| Premiere Pro | `export_sequence` | `outputPath`, `preset?` | low |
| After Effects | `add_keyframe` | `layer`, `property`, `time`, `value` | medium |
| After Effects | `render_comp` | `outputPath`, `compName?`, `template?` | medium |
| After Effects | `delete_layer` | `layer` | **high** |
| Photoshop | `apply_lut` | `layer`, `lutName` | low |
| Photoshop | `apply_curves` | `channel`, `points` | low |
| Photoshop | `resize` | `width`, `height`, `resample?` | medium |
| Photoshop | `export` | `outputPath`, `format?` | low |
| Illustrator | `replace_text` | `textObject`, `value` | low |
| Illustrator | `export` | `outputPath`, `format?` | low |

**Execution modes:**
- **real** — fires ExtendScript into the running Adobe app via `osascript`
- **mock** — simulates the result (set `CREATIVECLAW_ADOBE_MOCK=true` or app not open)

The connector auto-detects which year's version of each Adobe app is running (2022–2025).

---

## API Reference

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Gateway liveness + uptime + worker count |
| `GET` | `/metrics` | Prometheus-format counters |
| `GET` | `/events` | Recent event bus entries |
| `GET` | `/tools` | Registered tool definitions |

### Workers & Adobe

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workers` | Connected workers + capabilities |
| `POST` | `/worker/execute` | Dispatch operation to worker (params: `workerId`, `app`, `operation`) |
| `GET` | `/worker/approvals` | List pending high-risk approvals |
| `POST` | `/worker/approve` | Approve a pending operation (params: `approvalId`, `actorId`) |
| `GET` | `/connectors/health` | Adobe connector status + running detection |

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | Active job queue |
| `GET` | `/jobs/history` | Paginated job history (`limit`, `offset`, `status`) |
| `GET` | `/jobs/operations` | Paginated operation execution log (`limit`, `offset`) |
| `GET` | `/jobs/stats` | Counts by status + risk |
| `POST` | `/jobs/add` | Add a job (params: `name`, `risk`) |
| `POST` | `/jobs/run` | Run next queued job |
| `POST` | `/jobs/approve` | Approve a queued high-risk job |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/memory/profiles` | All project style profiles |
| `GET` | `/memory/profile?projectId=` | Single project profile + recent signals |
| `GET` | `/memory/stats` | Total signals, projects, vector records |
| `POST` | `/memory/remember` | Record a style signal (`projectId`, `editType`, `confidence`, `approved`) |
| `GET` | `/memory/demo` | Demo signal + aggregate |

### Team

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/team/users` | List team members + roles |
| `POST` | `/team/users` | Add/update member (`userId`, `role`) |
| `DELETE` | `/team/users?userId=` | Remove member |

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/search?q=` | Brave web search |
| `GET` | `/apis` | External API templates |
| `POST` | `/telegram/inbound` | Telegram webhook receiver |

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Ping the gateway |
| `/status` | Health + worker count + running Adobe apps |
| `/run-job <name>` | Add and run a low-risk job |
| `/approve <approvalId>` | Approve a pending high-risk operation (owner/reviewer only) |

---

## Team Roles

| Role | Can Execute | Can Approve High-Risk | Manage Team |
|------|-------------|----------------------|-------------|
| `owner` | ✅ | ✅ | ✅ |
| `reviewer` | ✅ | ✅ | — |
| `editor` | ✅ | — | — |
| `viewer` | — | — | — |

The initial owner is seeded from `CREATIVECLAW_OWNER_ID` on first run.

---

## Dashboard

The dashboard (`port 3790`) is a zero-dependency dark-mode HTML page that polls the gateway every 5 seconds and shows:

- **Stat cards** — total jobs, done, failed, pending approvals, workers, memory signals, projects, operations logged
- **Adobe connectors** — running status + execution mode per app
- **Connected workers** — capabilities + idle time
- **Pending approvals** — one-click context for reviewer action
- **Team members** — roles + join timestamps
- **Operation history** — last 25 executed operations with duration + mode
- **Job queue history** — last 30 jobs with status, attempts, errors
- **Style memory profiles** — per-project signal counts, confidence, top edit types
- **Event counters** — all gateway events
- **Prometheus metrics** — raw text block

---

## Error Catalog

All API errors return structured JSON:

```json
{ "error": "ERR_FORBIDDEN", "message": "...", "details": {} }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `ERR_FORBIDDEN` | 403 | RBAC role insufficient |
| `ERR_NOT_FOUND` | 404 | Resource doesn't exist |
| `ERR_VALIDATION` | 400 | Payload schema failure |
| `ERR_APPROVAL_REQUIRED` | 202 | High-risk op queued for approval |
| `ERR_WORKER_TIMEOUT` | 504 | Worker didn't respond in time |
| `ERR_WORKER_BAD_RESPONSE` | 502 | Malformed worker response |
| `ERR_APPROVAL_CONFLICT` | 409 | Duplicate pending approval |
| `ERR_APPROVAL_INVALID` | 400 | Approval ID expired or invalid |
| `ERR_BRIDGE_UNAVAILABLE` | 503 | Adobe worker not connected |
| `ERR_ADOBE_OPERATION` | 500 | Adobe app returned an error |
| `ERR_RATE_LIMIT` | 429 | Too many requests |
| `ERR_INTERNAL` | 500 | Unexpected server error |

See [`docs/runbook.md`](docs/runbook.md) for per-error causes, resolution steps, and common operational tasks.

---

## Load Testing

```bash
# Requires gateway running at localhost:3789
bash load-tests/execute.sh       # POST /worker/execute
bash load-tests/approve.sh       # POST /worker/approve
bash load-tests/team-users.sh    # GET /team/users
bash load-tests/full-suite.sh    # All three in sequence
```

Env overrides: `BASE_URL`, `DURATION` (secs), `CONNECTIONS`.

---

## Security

```bash
bash scripts/security-check.sh
```

Checks: hardcoded secrets, `.env` not tracked, debug endpoints, `.gitignore` coverage, TypeScript strict mode, `pnpm audit`.

CI runs this automatically on every push via `.github/workflows/ci.yml`.

---

## Testing

```bash
pnpm build
pnpm test                              # all workspace unit tests (13 errors tests + stubs)
bash tests/smoke.sh                    # gateway smoke test
node tests/phase3-checks.mjs           # style learning + vector backends
node tests/integration-gateway-worker.mjs  # full gateway ↔ worker flow
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
fly secrets set TELEGRAM_BOT_TOKEN=... CREATIVECLAW_OWNER_ID=...
fly deploy
```

### systemd (Linux)
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
| 3 | Style learning engine, vector memory abstraction, observability event bus, Prometheus metrics |
| 4 | Dashboard skeleton, integration tests, smoke tests |
| 5 | Team RBAC (owner/editor/reviewer/viewer), role-gated approvals, Telegram `/approve` |
| 6 | Load tests, typed error catalog, runbook, security-check script, CI workflow |
| 7 | **Real Adobe bridge** — ExtendScript generator, macOS osascript execution, 13 operations across 4 apps, mock fallback |
| 8 | **Persistent memory** — SQLite vector store, persistent style signals, project profiles, operation history log |
| 9 | **Full dashboard** — live dark-mode UI with 8 stat cards, 7 data tables, auto-refresh |
| 10 | **Deployment** — Dockerfile, docker-compose, Fly.io config, systemd unit, one-line install script, graceful shutdown |

---

## License

MIT

---

## Acknowledgements

CreativeClaw is inspired by production patterns from modern AI agent systems and OpenClaw-style operational design (gateway lifecycle, policy-first execution, health/doctor workflows).
