import { createServer, IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { mergeConfig } from '../../../packages/core/src/index.js';
import { ToolRegistry } from '../../../packages/tool-registry/src/index.js';
import { MemoryStore } from '../../../packages/memory/src/index.js';
import { AdobeConnectorHub, getOperationSchema, validateOperationPayload } from '../../../packages/connectors-adobe/src/index.js';
import { BraveSearchClient } from '../../../packages/search/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';
import { JobQueue } from '../../../packages/jobs/src/index.js';
import { EventBus } from '../../../packages/observability/src/index.js';
import { TeamRBAC } from '../../../packages/collaboration/src/index.js';
import type { LocalBridgeMessage, WorkerExecute, WorkerHello, WorkerResult } from '../../../packages/protocol/src/index.js';

// ─── Startup env validation ──────────────────────────────────────────────────

const REQUIRED_SOFT = ['TELEGRAM_BOT_TOKEN', 'CREATIVECLAW_OWNER_ID'];
for (const v of REQUIRED_SOFT) {
  if (!process.env[v]) {
    console.warn(`[CreativeClaw] WARN: ${v} is not set. Some features will be disabled.`);
  }
}

// ─── Services ────────────────────────────────────────────────────────────────

const config = mergeConfig({});
const tools = new ToolRegistry();
const memory = new MemoryStore();
const connectors = new AdobeConnectorHub();
const search = new BraveSearchClient(process.env.BRAVE_SEARCH_API_KEY);
const apis = new APIRegistry();
const jobs = new JobQueue();
const events = new EventBus();
const team = new TeamRBAC();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const workers = new Map<string, { ws: WebSocket; capabilities: string[]; lastSeen: number }>();
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }>();
const pendingApprovals = new Map<string, WorkerExecute & { workerId: string; risk: 'low' | 'medium' | 'high' }>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf-8')));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res: import('node:http').ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Worker dispatch ─────────────────────────────────────────────────────────

async function dispatchToWorker(
  workerId: string,
  app: WorkerExecute['app'],
  operation: string,
  payload?: Record<string, unknown>,
) {
  const worker = workers.get(workerId);
  if (!worker) return { ok: false, error: 'worker_not_found' };

  const requestId = randomUUID();
  const message: WorkerExecute = { type: 'execute', requestId, app, operation, payload };
  const start = Date.now();

  const result = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('worker_timeout'));
    }, 7000);
    pending.set(requestId, { resolve, reject, timeout });
    worker.ws.send(JSON.stringify(message));
  }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

  const durationMs = Date.now() - start;

  // Log the operation to persistent history
  jobs.logOperation({
    app,
    operation,
    workerId,
    ok: result?.ok ?? false,
    payload: payload ? JSON.stringify(payload) : undefined,
    output: result?.output ? JSON.stringify(result.output) : undefined,
    error: result?.error,
    executionMode: result?.executionMode ?? 'mock',
    durationMs,
    timestamp: Date.now(),
  });

  return result;
}

tools.register({
  name: 'search_tools',
  description: 'Discover tools progressively by query and detail level',
  risk: 'low',
  schema: { query: 'string', detail_level: 'name_only|name_description|full_schema' },
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // ── Core ──────────────────────────────────────────────────────────────────

  if (url.pathname === '/health') {
    events.emit('health_check');
    json(res, 200, {
      ok: true,
      app: 'creativeclaw-gateway',
      version: '0.7.0',
      uptime: Math.floor(process.uptime()),
      workers: workers.size,
      pendingApprovals: pendingApprovals.size,
    });
    return;
  }

  if (url.pathname === '/events') {
    json(res, 200, { counters: events.counters(), recent: events.list(50) });
    return;
  }

  if (url.pathname === '/metrics') {
    const counters = events.counters();
    const lines = [
      '# HELP creativeclaw_events_total Total events by name',
      '# TYPE creativeclaw_events_total counter',
      ...Object.entries(counters).map(([name, value]) => `creativeclaw_events_total{name="${name}"} ${value}`),
      `creativeclaw_workers_connected ${workers.size}`,
      `creativeclaw_pending_approvals ${pendingApprovals.size}`,
      `creativeclaw_pending_requests ${pending.size}`,
    ];
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(lines.join('\n') + '\n');
    return;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  if (url.pathname === '/tools') {
    json(res, 200, tools.list());
    return;
  }

  // ── Team / RBAC ───────────────────────────────────────────────────────────

  if (url.pathname === '/team/users' && req.method === 'GET') {
    json(res, 200, team.list());
    return;
  }

  if (url.pathname === '/team/users' && req.method === 'POST') {
    const body = await readBody(req);
    const { userId, role } = body;
    if (!userId || !role) { json(res, 400, { ok: false, error: 'userId and role required' }); return; }
    const row = team.upsert(userId, role);
    events.emit('team_user_upserted', 'info', { userId: row.userId, role: row.role });
    json(res, 200, row);
    return;
  }

  if (url.pathname === '/team/users' && req.method === 'DELETE') {
    const userId = url.searchParams.get('userId') || '';
    if (!userId) { json(res, 400, { ok: false, error: 'userId required' }); return; }
    team.remove(userId);
    events.emit('team_user_removed', 'warn', { userId });
    json(res, 200, { ok: true, removed: userId });
    return;
  }

  // ── Workers ───────────────────────────────────────────────────────────────

  if (url.pathname === '/workers') {
    json(res, 200,
      [...workers.entries()].map(([id, w]) => ({
        workerId: id,
        capabilities: w.capabilities,
        lastSeen: w.lastSeen,
        idleSecs: Math.floor((Date.now() - w.lastSeen) / 1000),
      })),
    );
    return;
  }

  // ── Worker execute ────────────────────────────────────────────────────────

  if (url.pathname === '/worker/execute' && req.method === 'POST') {
    const workerId = url.searchParams.get('workerId') || '';
    const app = url.searchParams.get('app') as WorkerExecute['app'];
    const operation = url.searchParams.get('operation') || '';
    const body = await readBody(req);

    if (!workerId || !app || !operation) {
      json(res, 400, { ok: false, error: 'workerId, app, operation required' });
      return;
    }

    const schema = getOperationSchema(app, operation);
    if (!schema) {
      json(res, 400, { ok: false, error: 'unknown_operation', app, operation });
      return;
    }

    const validation = validateOperationPayload(schema, body);
    if (!validation.ok) {
      json(res, 400, { ok: false, error: 'invalid_payload', missing: validation.missing });
      return;
    }

    if (schema.risk === 'high') {
      events.emit('approval_required', 'info', { app, operation, risk: schema.risk });
      const approvalId = randomUUID();
      pendingApprovals.set(approvalId, { type: 'execute', requestId: randomUUID(), app, operation, payload: body, workerId, risk: schema.risk });
      await sendTelegramMessage(`⚠️ Approval required\nOp: ${operation} (${app})\nRisk: HIGH\nID: ${approvalId}`);
      json(res, 202, { ok: false, needsApproval: true, approvalId, risk: schema.risk });
      return;
    }

    events.emit('worker_execute', 'info', { workerId, app, operation, risk: schema.risk });
    const result = await dispatchToWorker(workerId, app, operation, body);
    json(res, 200, result);
    return;
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  if (url.pathname === '/worker/approvals') {
    json(res, 200,
      [...pendingApprovals.entries()].map(([id, v]) => ({
        approvalId: id,
        app: v.app,
        operation: v.operation,
        workerId: v.workerId,
        risk: v.risk,
      })),
    );
    return;
  }

  if (url.pathname === '/worker/approve' && req.method === 'POST') {
    const approvalId = url.searchParams.get('approvalId') || '';
    const actorId = url.searchParams.get('actorId') || '';

    if (!actorId || !team.canApprove(actorId)) {
      json(res, 403, { ok: false, error: 'forbidden', message: 'actor lacks approval role' });
      return;
    }

    const reqObj = pendingApprovals.get(approvalId);
    if (!reqObj) {
      json(res, 404, { ok: false, error: 'approval_not_found' });
      return;
    }

    pendingApprovals.delete(approvalId);
    events.emit('approval_executed', 'info', { approvalId, actorId, app: reqObj.app, operation: reqObj.operation });
    const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload);
    json(res, 200, result);
    return;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  if (url.pathname === '/jobs' && req.method === 'GET') {
    json(res, 200, jobs.list());
    return;
  }

  if (url.pathname === '/jobs/history' && req.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status') as any || undefined;
    json(res, 200, jobs.history({ limit, offset, status }));
    return;
  }

  if (url.pathname === '/jobs/operations' && req.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    json(res, 200, jobs.operationHistory(limit, offset));
    return;
  }

  if (url.pathname === '/jobs/stats' && req.method === 'GET') {
    json(res, 200, jobs.stats());
    return;
  }

  if (url.pathname === '/jobs/add' && req.method === 'POST') {
    const risk = (url.searchParams.get('risk') as 'low' | 'medium' | 'high') || 'low';
    const name = url.searchParams.get('name') || 'unnamed_job';
    const job = jobs.add(name, risk);
    json(res, 200, job);
    return;
  }

  if (url.pathname === '/jobs/approve' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    const job = jobs.approve(id);
    json(res, 200, job || { error: 'job_not_found' });
    return;
  }

  if (url.pathname === '/jobs/run' && req.method === 'POST') {
    const ran = await jobs.runNext(async (job) => {
      if (job.name.includes('fail')) throw new Error('Simulated failure');
      await sendTelegramMessage(`✅ CreativeClaw job done: ${job.name}`);
    });
    json(res, 200, ran || { status: 'no_queued_jobs' });
    return;
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  if (url.pathname === '/memory/demo') {
    memory.remember({
      editType: 'trim_clip',
      projectId: 'demo',
      confidence: 0.8,
      approved: true,
      timestamp: Date.now(),
      signals: { shotLength: 2.4 },
    });
    json(res, 200, memory.aggregate('demo'));
    return;
  }

  if (url.pathname === '/memory/profiles') {
    json(res, 200, memory.listProjects());
    return;
  }

  if (url.pathname === '/memory/profile' && req.method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    if (!projectId) { json(res, 400, { error: 'projectId required' }); return; }
    json(res, 200, { projectId, aggregate: memory.aggregate(projectId), signals: memory.recall(projectId, 20) });
    return;
  }

  if (url.pathname === '/memory/stats') {
    json(res, 200, memory.stats());
    return;
  }

  if (url.pathname === '/memory/remember' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId || !body.editType) {
      json(res, 400, { error: 'projectId and editType required' });
      return;
    }
    memory.remember({
      projectId: body.projectId,
      editType: body.editType,
      confidence: body.confidence ?? 0.5,
      approved: body.approved ?? false,
      timestamp: Date.now(),
      signals: body.signals ?? {},
    });
    json(res, 200, { ok: true });
    return;
  }

  // ── Connectors ────────────────────────────────────────────────────────────

  if (url.pathname === '/connectors/health') {
    const health = await connectors.health();
    json(res, 200, health);
    return;
  }

  // ── Search / APIs ─────────────────────────────────────────────────────────

  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') || 'creative automation';
    try {
      const results = await search.search(q, 5);
      json(res, 200, { query: q, results });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (url.pathname === '/apis') {
    json(res, 200, { templates: apis.listTemplates() });
    return;
  }

  // ── Telegram inbound ──────────────────────────────────────────────────────

  if (url.pathname === '/telegram/inbound' && req.method === 'POST') {
    try {
      const update = await readBody(req);
      const text = (update?.message?.text || '').trim();
      const actorId = String(update?.message?.from?.id || '');

      if (text === '/start') {
        await sendTelegramMessage('CreativeClaw is online ✅');
      } else if (text === '/status') {
        const h = await connectors.health();
        const running = h.filter(c => c.running).map(c => c.app);
        await sendTelegramMessage(
          `Status: healthy ✅\nWorkers: ${workers.size}\nPending approvals: ${pendingApprovals.size}\nAdobe running: ${running.join(', ') || 'none'}`,
        );
      } else if (text.startsWith('/run-job')) {
        const name = text.replace('/run-job', '').trim() || 'telegram_job';
        const job = jobs.add(name, 'low');
        await jobs.runNext(async () => {});
        await sendTelegramMessage(`Job executed: ${job.name}`);
      } else if (text.startsWith('/approve ')) {
        const id = text.replace('/approve', '').trim();
        if (!team.canApprove(actorId)) {
          await sendTelegramMessage(`❌ Actor ${actorId} is not allowed to approve.`);
        } else {
          const reqObj = pendingApprovals.get(id);
          if (reqObj) {
            pendingApprovals.delete(id);
            events.emit('approval_executed', 'info', { approvalId: id, actorId, app: reqObj.app, operation: reqObj.operation });
            const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload);
            await sendTelegramMessage(`✅ Approved and executed ${reqObj.operation}\nResult: ${JSON.stringify(result).slice(0, 300)}`);
          } else {
            await sendTelegramMessage(`Approval id not found: ${id}`);
          }
        }
      } else if (text) {
        await sendTelegramMessage(`CreativeClaw received: ${text}`);
      }

      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  json(res, 404, { error: 'not_found' });
});

// ─── WebSocket bridge ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').startsWith('/ws/local')) {
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket) => {
  let workerId = '';

  ws.on('message', (raw: WebSocket.RawData) => {
    const msg = JSON.parse(String(raw)) as LocalBridgeMessage;

    if (msg.type === 'worker_hello') {
      const hello = msg as WorkerHello;
      workerId = hello.workerId;
      workers.set(workerId, { ws, capabilities: hello.capabilities, lastSeen: Date.now() });
      events.emit('worker_connected', 'info', { workerId, capabilities: hello.capabilities });
      return;
    }

    if (msg.type === 'result') {
      const result = msg as WorkerResult;
      const pendingReq = pending.get(result.requestId);
      if (pendingReq) {
        clearTimeout(pendingReq.timeout);
        pendingReq.resolve(result);
        pending.delete(result.requestId);
      }
      events.emit('worker_result', result.ok ? 'info' : 'warn', { requestId: result.requestId, ok: result.ok });
      if (workerId && workers.has(workerId)) {
        workers.get(workerId)!.lastSeen = Date.now();
      }
    }
  });

  ws.on('close', () => {
    if (workerId) {
      workers.delete(workerId);
      events.emit('worker_disconnected', 'warn', { workerId });
    }
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[CreativeClaw] ${signal} received — shutting down gracefully...`);

  // Reject all pending requests
  for (const [id, p] of pending.entries()) {
    clearTimeout(p.timeout);
    p.reject(new Error('gateway_shutting_down'));
    pending.delete(id);
  }

  // Close all worker connections
  for (const [id, w] of workers.entries()) {
    w.ws.close(1001, 'Gateway shutting down');
    workers.delete(id);
  }

  server.close(() => {
    console.log('[CreativeClaw] Gateway stopped.');
    process.exit(0);
  });

  // Force exit after 5s if server hangs
  setTimeout(() => {
    console.error('[CreativeClaw] Force exit after timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(config.gateway.port, config.gateway.host, () => {
  console.log(`[CreativeClaw] Gateway v0.7.0 running at http://${config.gateway.host}:${config.gateway.port}`);
  console.log(`[CreativeClaw] Mock mode: ${process.env.CREATIVECLAW_ADOBE_MOCK ?? 'false'}`);
});
