# CreativeClaw

**Production-ready AI agent for creative professionals** — built for Premiere Pro, After Effects, Photoshop, and Illustrator workflows.

CreativeClaw bridges natural language control (Telegram + CLI) with pro creative tooling, while enforcing secure execution, approvals, and observable operations.

---

## Why CreativeClaw

- 🎬 Multi-app creative workflows (video + design)
- 🧠 CodeAct-style executable actions for complex tasks
- 🔌 MCP-inspired progressive tool discovery (`search_tools`)
- 🛡️ Approval-gated high-risk operations
- 🖥️ Local, VPS, and hybrid deployment options
- 🧱 Extensible connector and API framework

---

## Current Status (v0.1 scaffold)

Implemented now:
- Monorepo structure (apps + packages)
- Gateway service with health/tools/connectors endpoints
- Telegram inbound command router (`/start`, `/status`, `/run-job`)
- Brave search integration endpoint (`GET /search?q=...`)
- API registry with templates (ElevenLabs, Freepik, Pexels)
- Encrypted API credential store (CLI add/test/remove/list)
- SQLite-backed job queue with retry + high-risk approval flow
- Local Adobe bridge over WebSocket (`/ws/local`) with worker registration and remote execute
- Worker management + command endpoint (`GET /workers`, `POST /worker/execute?...`)
- Operation schema validation with required payload fields
- Risk classification per Adobe operation (low/medium/high)
- High-risk approval flow (`GET /worker/approvals`, `POST /worker/approve?approvalId=...`)
- Worker-side connector handlers wired by app/operation
- Weighted style-learning confidence engine (approval + recency aware)
- Vector memory backend abstraction (in-memory backend included)
- Observability event bus + `/events` endpoint
- Prometheus-friendly `/metrics` endpoint
- Dashboard skeleton app (`@creativeclaw/dashboard`)
- CLI (`status`, `doctor`, `config`, `api templates`, `api add/test/remove/list/show`)
- Tool registry with progressive detail levels
- Action executor (sandboxed runtime stub)
- Style memory store (signal + aggregate)
- Adobe connector hub (health stubs for 4 apps)

Next milestones are in [Roadmap](#roadmap).

---

## Architecture

```txt
creativeclaw/
  apps/
    gateway/            # control plane API
    cli/                # creativeclaw command
  packages/
    core/               # config + shared types
    tool-registry/      # MCP-style discovery/search
    action-executor/    # executable actions runtime
    memory/             # style/fact memory
    connectors-adobe/   # premiere/ae/ps/ai adapters
```

---

## Quick Start

### Prerequisites
- Node.js 22+
- npm 10+

### Install

```bash
git clone https://github.com/bnsa3ed/CreativeClaw.git
cd CreativeClaw
npm install
```

### Build

```bash
npm run build
```

### Run gateway

```bash
npm run -w @creativeclaw/gateway start
# -> http://127.0.0.1:3789/health
```

### Run local worker bridge

```bash
npm run -w @creativeclaw/worker-local build
node dist/apps/worker-local/src/index.js
```

### Run dashboard (optional)

```bash
npm run -w @creativeclaw/dashboard build
node dist/apps/dashboard/src/index.js
# -> http://127.0.0.1:3790
```

### Run CLI

```bash
npm run -w @creativeclaw/cli build
node apps/cli/dist/index.js status
node apps/cli/dist/index.js doctor
```

---

## API Endpoints (current)

- `GET /health` → gateway liveness
- `GET /tools` → registered tools
- `GET /connectors/health` → Adobe connector status
- `GET /memory/demo` → memory signal + aggregate demo

---

## Security Model (target)

- Default-deny tool policy
- Approval gates for high-risk operations
- Sandboxed action execution
- Audited action traces
- Secret vault injection (env-scoped)

---

## Roadmap

### Phase 1
- Telegram command loop
- Brave search integration
- API registry + templates
- Job queue and retry policies

### Phase 2
- Premiere + After Effects command adapters
- Photoshop + Illustrator adapters
- Local worker bridge (WS)

### Phase 3
- Style learning pipeline (weighted confidence)
- Vector memory backend support
- Dashboard and observability

### Phase 4
- Full production hardening
- Load/failure tests
- Security audit pass

---

## Testing

Current checks:

```bash
npm run build
./tests/smoke.sh
node tests/phase3-checks.mjs
node tests/integration-gateway-worker.mjs
```


---

## License

MIT (or your preferred license, update before release)

---

## Acknowledgements

CreativeClaw architecture is inspired by production lessons from modern agent systems and OpenClaw-style operational patterns (gateway lifecycle, health/doctor workflows, policy-first execution).
