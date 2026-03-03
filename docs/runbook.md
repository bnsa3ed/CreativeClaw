# CreativeClaw Runbook

Operational reference for the CreativeClaw gateway. Use this when diagnosing errors, alerts, or incidents.

---

## Error Catalog

All structured errors in CreativeClaw use machine-readable codes from `@creativeclaw/errors`. They are returned as JSON:

```json
{
  "error": "ERR_FORBIDDEN",
  "message": "You do not have permission to perform this action.",
  "details": { "actorId": "12345", "requiredRole": "reviewer" }
}
```

---

### `ERR_FORBIDDEN` — 403

| Field | Value |
|-------|-------|
| HTTP Status | 403 |
| Package | `@creativeclaw/errors` |

**Cause:** The actor attempting the operation does not have a sufficient RBAC role. Common cases:
- A `viewer` attempting to approve a high-risk operation (requires `reviewer` or `owner`)
- A user not in the team store trying to call `/team/users`

**Resolution:**
1. Check the actor's role: `GET /team/users` and find the user.
2. Promote their role via `POST /team/users` with the appropriate role.
3. If the actor should not have access, this error is working as intended.

---

### `ERR_NOT_FOUND` — 404

| Field | Value |
|-------|-------|
| HTTP Status | 404 |

**Cause:** A requested resource (user, job, approval, tool) does not exist.

**Resolution:**
1. Verify the ID being requested (typo? stale reference?).
2. Check that the resource was not already deleted or expired.
3. For approvals: they expire after the configured TTL — resubmit the operation.

---

### `ERR_VALIDATION` — 400

| Field | Value |
|-------|-------|
| HTTP Status | 400 |

**Cause:** The request body failed schema validation. The `details` field contains the specific validation errors.

**Resolution:**
1. Read the `details` array for which fields are missing or invalid.
2. Correct the payload and retry.
3. See `packages/protocol/src/` for the expected schema definitions.

---

### `ERR_APPROVAL_REQUIRED` — 202

| Field | Value |
|-------|-------|
| HTTP Status | 202 (Accepted — not an error per se) |

**Cause:** The requested operation is classified as high-risk and requires explicit approval from a `reviewer` or `owner` before execution.

**Resolution:**
1. An `approvalId` is included in the response `details`.
2. A `reviewer` or `owner` must send `/approve <approvalId>` via Telegram, or call `POST /worker/approve?approvalId=<id>&actorId=<id>`.
3. The original operation will execute once approved.

---

### `ERR_WORKER_TIMEOUT` — 504

| Field | Value |
|-------|-------|
| HTTP Status | 504 |

**Cause:** The local Adobe worker (WebSocket bridge) did not respond within the configured timeout window.

**Resolution:**
1. Check that the local worker process is running: `ps aux | grep creativeclaw-worker`
2. Check worker logs for stuck operations or Adobe crashes.
3. Restart the worker: `pnpm -w run dev` or the worker-specific start command.
4. If timeouts are frequent, increase the timeout in `core` config or optimize the Adobe operations.

---

### `ERR_WORKER_BAD_RESPONSE` — 502

| Field | Value |
|-------|-------|
| HTTP Status | 502 |

**Cause:** The worker responded but with a malformed or unexpected payload. Usually a protocol version mismatch.

**Resolution:**
1. Ensure the worker and gateway are on the same version.
2. Check `packages/protocol/` for schema changes.
3. Restart both worker and gateway after updating.

---

### `ERR_APPROVAL_CONFLICT` — 409

| Field | Value |
|-------|-------|
| HTTP Status | 409 |

**Cause:** A pending approval for this operation already exists. Duplicate approval requests are rejected to prevent double-execution.

**Resolution:**
1. Check pending approvals in the approval store.
2. Either approve/reject the existing pending approval, or wait for it to expire.
3. Do not resubmit the operation until the conflict is resolved.

---

### `ERR_APPROVAL_INVALID` — 400

| Field | Value |
|-------|-------|
| HTTP Status | 400 |

**Cause:** The `approvalId` provided to `/worker/approve` is not found or has expired.

**Resolution:**
1. Approvals expire after the configured TTL (default: 10 minutes).
2. Resubmit the original operation to generate a fresh approval request.
3. Verify the `approvalId` was not already used (approvals are single-use).

---

### `ERR_INTERNAL` — 500

| Field | Value |
|-------|-------|
| HTTP Status | 500 |

**Cause:** An unexpected error occurred server-side. This is a catch-all for unhandled exceptions.

**Resolution:**
1. Check the gateway logs immediately: `journalctl -u creativeclaw -n 100` or `pnpm dev` console.
2. Look for the stack trace associated with the timestamp.
3. If the error is reproducible, open an issue with the full stack trace and request payload.

---

### `ERR_RATE_LIMIT` — 429

| Field | Value |
|-------|-------|
| HTTP Status | 429 |

**Cause:** The client has exceeded the rate limit for the endpoint.

**Resolution:**
1. Respect the `retryAfterSeconds` field in the error details.
2. Implement exponential backoff in your client.
3. If legitimate high traffic, consider increasing rate limits in the gateway config.

---

### `ERR_ADOBE_OPERATION` — 500

| Field | Value |
|-------|-------|
| HTTP Status | 500 |

**Cause:** The Adobe operation itself failed (e.g., Photoshop script error, unsupported action).

**Resolution:**
1. Check the `details` field for the underlying Adobe error message.
2. Verify the operation parameters are valid for the Adobe product version installed.
3. Test the operation manually in Adobe to confirm it works outside CreativeClaw.

---

### `ERR_BRIDGE_UNAVAILABLE` — 503

| Field | Value |
|-------|-------|
| HTTP Status | 503 |

**Cause:** The WebSocket bridge (local worker) is not connected to the gateway. All Adobe operations will fail until it reconnects.

**Resolution:**
1. Check if the worker is running: `ps aux | grep worker`
2. Restart the worker process.
3. Verify network/firewall allows the WebSocket connection on the configured port.
4. Check `packages/connectors-adobe/` config for the bridge URL.

---

## Common Operational Tasks

### Restarting the Gateway

```bash
# Development
pnpm dev

# Production (if using pm2)
pm2 restart creativeclaw-gateway
```

### Adding a Team Member

```bash
curl -X POST http://localhost:3789/team/users \
  -H "Content-Type: application/json" \
  -d '{"userId": "12345678", "role": "editor"}'
```

### Approving a Pending Operation

Via Telegram:
```
/approve <approvalId>
```

Via API:
```bash
curl -X POST "http://localhost:3789/worker/approve?approvalId=<id>&actorId=<your-id>"
```

### Checking Pending Approvals

```bash
curl http://localhost:3789/worker/approvals
```

### Running the Security Check

```bash
bash scripts/security-check.sh
```

### Running Load Tests

```bash
# Requires the gateway to be running
bash load-tests/full-suite.sh
```
