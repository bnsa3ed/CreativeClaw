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
- Telegram inbound webhook wiring (`POST /telegram/inbound`)
- Brave search integration endpoint (`GET /search?q=...`)
- API registry with templates (ElevenLabs, Freepik, Pexels)
- In-memory job queue with retry + high-risk approval flow
- CLI (`status`, `doctor`, `config`, `api list`, `api show <name>`)
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

Current smoke checks:

```bash
npm run build
node apps/cli/dist/index.js status
curl http://127.0.0.1:3789/health
```

(Comprehensive integration tests will be added as connector APIs are wired.)

---

## License

MIT (or your preferred license, update before release)

---

## Acknowledgements

CreativeClaw architecture is inspired by production lessons from modern agent systems and OpenClaw-style operational patterns (gateway lifecycle, health/doctor workflows, policy-first execution).
