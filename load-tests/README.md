# CreativeClaw Load Tests

Stress-test scripts for the key CreativeClaw gateway endpoints using [autocannon](https://github.com/mcollina/autocannon).

## Prerequisites

```bash
npm install -g autocannon
# or run via npx:
npx autocannon ...
```

Make sure the gateway is running locally:
```bash
pnpm dev
# Gateway listens on http://127.0.0.1:3789 by default
```

## Scripts

| Script | Endpoint | Description |
|--------|----------|-------------|
| `execute.sh` | `POST /worker/execute` | Simulates concurrent job submission |
| `approve.sh` | `POST /worker/approve` | Tests approval throughput |
| `team-users.sh` | `GET /team/users` | Read-heavy team list queries |
| `full-suite.sh` | All endpoints | Sequential full-suite run |

## Running

```bash
# Individual
bash load-tests/execute.sh
bash load-tests/approve.sh
bash load-tests/team-users.sh

# Full suite
bash load-tests/full-suite.sh
```

## Parameters

Override defaults with env vars:

| Var | Default | Description |
|-----|---------|-------------|
| `BASE_URL` | `http://127.0.0.1:3789` | Gateway base URL |
| `DURATION` | `30` | Test duration in seconds |
| `CONNECTIONS` | `10` | Concurrent connections |
| `PIPELINING` | `1` | HTTP pipelining factor |

Example:
```bash
BASE_URL=http://staging.example.com CONNECTIONS=50 DURATION=60 bash load-tests/full-suite.sh
```

## Reading Results

autocannon outputs:
- **Req/sec** — throughput
- **Latency (p50/p99/p999)** — response time percentiles
- **Errors** — non-2xx or timeout responses

A healthy gateway should sustain:
- `/worker/execute` → ≥ 50 req/s, p99 < 500ms
- `/worker/approve` → ≥ 100 req/s, p99 < 200ms
- `/team/users` → ≥ 200 req/s, p99 < 100ms
