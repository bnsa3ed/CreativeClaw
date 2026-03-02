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

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
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

async function dispatchToWorker(workerId: string, app: WorkerExecute['app'], operation: string, payload?: Record<string, unknown>) {
  const worker = workers.get(workerId);
  if (!worker) return { ok: false, error: 'worker_not_found' };

  const requestId = randomUUID();
  const message: WorkerExecute = { type: 'execute', requestId, app, operation, payload };

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('worker_timeout'));
    }, 7000);
    pending.set(requestId, { resolve, reject, timeout });
    worker.ws.send(JSON.stringify(message));
  }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
}

tools.register({
  name: 'search_tools',
  description: 'Discover tools progressively by query and detail level',
  risk: 'low',
  schema: { query: 'string', detail_level: 'name_only|name_description|full_schema' }
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    events.emit('health_check');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'creativeclaw-gateway' }));
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ counters: events.counters(), recent: events.list(50) }));
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
      `creativeclaw_pending_requests ${pending.size}`
    ];
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(lines.join('\n'));
    return;
  }

  if (url.pathname === '/tools') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tools.list()));
    return;
  }

  if (url.pathname === '/workers') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...workers.entries()].map(([id, w]) => ({ workerId: id, capabilities: w.capabilities, lastSeen: w.lastSeen }))));
    return;
  }

  if (url.pathname === '/team/users' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(team.list()));
    return;
  }

  if (url.pathname === '/team/users' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const userId = String(body.userId || '');
    const role = body.role as any;
    if (!userId || !['owner','editor','reviewer','viewer'].includes(role)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_user_or_role' }));
      return;
    }
    const row = team.upsert(userId, role);
    events.emit('team_user_upserted', 'info', { userId: row.userId, role: row.role });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user: row }));
    return;
  }

  if (url.pathname === '/team/users' && req.method === 'DELETE') {
    const userId = url.searchParams.get('userId') || '';
    if (!userId) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing_userId' }));
      return;
    }
    team.remove(userId);
    events.emit('team_user_removed', 'warn', { userId });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/worker/execute' && req.method === 'POST') {
    const workerId = url.searchParams.get('workerId') || '';
    const app = (url.searchParams.get('app') || 'premiere') as WorkerExecute['app'];
    const operation = url.searchParams.get('operation') || 'noop';
    const payload = await readBody(req).catch(() => ({}));

    const schema = getOperationSchema(app, operation);
    if (!schema) {
      events.emit('worker_execute_unknown', 'warn', { app, operation });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unknown_operation' }));
      return;
    }

    const valid = validateOperationPayload(schema, payload);
    if (!valid.ok) {
      events.emit('worker_execute_invalid_payload', 'warn', { app, operation, missing: valid.missing });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_payload', missing: valid.missing }));
      return;
    }

    if (schema.risk === 'high') {
      events.emit('approval_required', 'info', { app, operation, risk: schema.risk });
      const approvalId = randomUUID();
      pendingApprovals.set(approvalId, { type: 'execute', requestId: randomUUID(), app, operation, payload, workerId, risk: schema.risk });
      await sendTelegramMessage(`Approval required: ${operation} (${app}) [id:${approvalId}]`);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, needsApproval: true, approvalId, risk: schema.risk }));
      return;
    }

    const result = await dispatchToWorker(workerId, app, operation, payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/worker/approvals') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...pendingApprovals.entries()].map(([id, v]) => ({ approvalId: id, app: v.app, operation: v.operation, workerId: v.workerId, risk: v.risk }))));
    return;
  }

  if (url.pathname === '/worker/approve' && req.method === 'POST') {
    const approvalId = url.searchParams.get('approvalId') || '';
    const actorId = url.searchParams.get('actorId') || '';
    if (!actorId || !team.canApprove(actorId)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden', message: 'actor lacks approval role' }));
      return;
    }

    const reqObj = pendingApprovals.get(approvalId);
    if (!reqObj) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'approval_not_found' }));
      return;
    }
    pendingApprovals.delete(approvalId);
    events.emit('approval_executed', 'info', { approvalId, actorId, app: reqObj.app, operation: reqObj.operation });
    const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') || 'creative automation';
    try {
      const results = await search.search(q, 5);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ query: q, results }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname === '/apis') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ templates: apis.listTemplates() }));
    return;
  }

  if (url.pathname === '/connectors/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(connectors.health()));
    return;
  }

  if (url.pathname === '/memory/demo') {
    memory.remember({ editType: 'trim_clip', projectId: 'demo', confidence: 0.8, approved: true, timestamp: Date.now(), signals: { shotLength: 2.4 } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(memory.aggregate('demo')));
    return;
  }

  if (url.pathname === '/jobs/add' && req.method === 'POST') {
    const risk = (url.searchParams.get('risk') as 'low' | 'medium' | 'high') || 'low';
    const name = url.searchParams.get('name') || 'unnamed_job';
    const job = jobs.add(name, risk);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(job));
    return;
  }

  if (url.pathname === '/jobs/approve' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    const job = jobs.approve(id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(job || { error: 'job_not_found' }));
    return;
  }

  if (url.pathname === '/jobs/run' && req.method === 'POST') {
    const ran = await jobs.runNext(async (job) => {
      if (job.name.includes('fail')) throw new Error('Simulated failure');
      await sendTelegramMessage(`CreativeClaw job done: ${job.name}`);
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ran || { status: 'no_queued_jobs' }));
    return;
  }

  if (url.pathname === '/jobs') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jobs.list()));
    return;
  }

  if (url.pathname === '/telegram/inbound' && req.method === 'POST') {
    try {
      const update = await readBody(req);
      const text = (update?.message?.text || '').trim();
      const actorId = String(update?.message?.from?.id || '');

      if (text === '/start') {
        await sendTelegramMessage('CreativeClaw is online ✅');
      } else if (text === '/status') {
        await sendTelegramMessage('Status: healthy, queue ready, connectors loaded.');
      } else if (text.startsWith('/run-job')) {
        const name = text.replace('/run-job', '').trim() || 'telegram_job';
        const job = jobs.add(name, 'low');
        await jobs.runNext(async () => {});
        await sendTelegramMessage(`Job executed: ${job.name}`);
      } else if (text.startsWith('/approve ')) {
        const id = text.replace('/approve', '').trim();
        if (!team.canApprove(actorId)) {
          await sendTelegramMessage(`Actor ${actorId} is not allowed to approve.`);
        } else {
          const reqObj = pendingApprovals.get(id);
          if (reqObj) {
            pendingApprovals.delete(id);
            const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload);
            await sendTelegramMessage(`Approved and executed ${reqObj.operation}: ${JSON.stringify(result)}`);
          } else {
            await sendTelegramMessage(`Approval id not found: ${id}`);
          }
        }
      } else if (text) {
        await sendTelegramMessage(`CreativeClaw received: ${text}`);
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

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
    if (workerId) workers.delete(workerId);
  });
});

server.listen(config.gateway.port, config.gateway.host, () => {
  console.log(`CreativeClaw gateway running at http://${config.gateway.host}:${config.gateway.port}`);
});
