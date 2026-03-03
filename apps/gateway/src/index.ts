import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { mergeConfig } from '../../../packages/core/src/index.js';
import { ToolRegistry } from '../../../packages/tool-registry/src/index.js';
import { MemoryStore } from '../../../packages/memory/src/index.js';
import { AdobeConnectorHub, getOperationSchema, validateOperationPayload } from '../../../packages/connectors-adobe/src/index.js';
import { browseAssets } from '../../../packages/connectors-adobe/src/asset-browser.js';
import { BraveSearchClient } from '../../../packages/search/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';
import { JobQueue } from '../../../packages/jobs/src/index.js';
import { EventBus } from '../../../packages/observability/src/index.js';
import { TeamRBAC } from '../../../packages/collaboration/src/index.js';
import { AuthManager } from '../../../packages/auth/src/index.js';
import { TelegramBot } from '../../../packages/telegram/src/index.js';
import { NLPRouter, ConversationMemory } from '../../../packages/ai/src/index.js';
import { Scheduler } from '../../../packages/scheduler/src/index.js';
import type { LocalBridgeMessage, WorkerExecute, WorkerHello, WorkerResult } from '../../../packages/protocol/src/index.js';

// ─── Startup env validation ──────────────────────────────────────────────────

const REQUIRED_SOFT = ['TELEGRAM_BOT_TOKEN', 'CREATIVECLAW_OWNER_ID'];
for (const v of REQUIRED_SOFT) {
  if (!process.env[v]) console.warn(`[CreativeClaw] WARN: ${v} not set — some features disabled.`);
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
const auth = new AuthManager();
const nlp = new NLPRouter();
const convoMemory = new ConversationMemory();
const scheduler = new Scheduler();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const WEBHOOK_PUBLIC_URL = process.env.CREATIVECLAW_PUBLIC_URL || '';
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || randomUUID().slice(0, 16);

const workers = new Map<string, { ws: WebSocket; capabilities: string[]; lastSeen: number }>();
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }>();
const pendingApprovals = new Map<string, WorkerExecute & { workerId: string; risk: 'low' | 'medium' | 'high' }>();

// ─── Telegram Bot ─────────────────────────────────────────────────────────────

const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN) : null;

function getFirstWorker(): string | null {
  return workers.size > 0 ? [...workers.keys()][0] : null;
}

if (bot) {
  // /start
  bot.command('start', async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `👋 <b>CreativeClaw is online</b>\n\nI can control Adobe apps on your behalf.\nTry: <i>"trim clip intro from 5s to 30s"</i>\n\nCommands: /help /status /workers /jobs /approve`);
  });

  // /help
  bot.command('help', async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `<b>CreativeClaw Commands</b>\n\n` +
      `/status — gateway health\n` +
      `/workers — connected Adobe workers\n` +
      `/jobs — recent job queue\n` +
      `/approve &lt;id&gt; — approve a high-risk operation\n` +
      `/assets — list open project assets\n` +
      `/clear — clear conversation history\n\n` +
      `<b>Natural language:</b>\n` +
      `Just type what you want:\n` +
      `<i>"trim clip intro from 5s to 30s"</i>\n` +
      `<i>"resize to 1920x1080"</i>\n` +
      `<i>"replace text 'Hello' with 'World'"</i>`);
  });

  // /status
  bot.command('status', async (msg) => {
    const h = await connectors.health();
    const running = h.filter(c => c.running).map(c => c.app);
    await bot.sendMessage(msg.chat.id,
      `<b>Gateway Status</b>\n\n` +
      `🟢 Online · v0.8.0\n` +
      `Workers: ${workers.size}\n` +
      `Pending approvals: ${pendingApprovals.size}\n` +
      `Adobe running: ${running.join(', ') || 'none'}\n` +
      `NLP: ${nlp.enabled ? '✅ Claude' : '⚠️ rule-based only'}`);
  });

  // /workers
  bot.command('workers', async (msg) => {
    if (workers.size === 0) { await bot.sendMessage(msg.chat.id, 'No workers connected.'); return; }
    const lines = [...workers.entries()].map(([id, w]) =>
      `• <code>${id}</code> — ${w.capabilities.join(', ')} (${Math.floor((Date.now() - w.lastSeen) / 1000)}s ago)`);
    await bot.sendMessage(msg.chat.id, `<b>Workers (${workers.size})</b>\n\n${lines.join('\n')}`);
  });

  // /jobs
  bot.command('jobs', async (msg) => {
    const list = jobs.list().slice(0, 10);
    if (!list.length) { await bot.sendMessage(msg.chat.id, 'No jobs yet.'); return; }
    const lines = list.map(j => `• ${j.status === 'done' ? '✅' : j.status === 'failed' ? '❌' : '⏳'} <b>${j.name}</b> — ${j.status}`);
    await bot.sendMessage(msg.chat.id, `<b>Recent Jobs</b>\n\n${lines.join('\n')}`);
  });

  // /assets
  bot.command('assets', async (msg) => {
    const workerId = getFirstWorker();
    if (!workerId) { await bot.sendMessage(msg.chat.id, 'No worker connected. Start the local worker first.'); return; }
    await bot.sendMessage(msg.chat.id, '🔍 Scanning open Adobe projects...');
    const apps: Array<'premiere' | 'aftereffects' | 'photoshop' | 'illustrator'> = ['premiere', 'aftereffects', 'photoshop', 'illustrator'];
    const results = await Promise.all(apps.map(a => browseAssets(a)));
    const lines: string[] = [];
    for (const r of results) {
      if (r.error || !r.items.length) continue;
      lines.push(`\n<b>${r.app}</b> — ${r.projectName || 'untitled'}`);
      r.items.slice(0, 5).forEach(item => lines.push(`  • ${item.name} (${item.type})`));
      if (r.items.length > 5) lines.push(`  … +${r.items.length - 5} more`);
    }
    await bot.sendMessage(msg.chat.id, lines.length ? lines.join('\n') : 'No open Adobe projects found.');
  });

  // /approve
  bot.command('approve', async (msg, args) => {
    const actorId = String(msg.from?.id || '');
    const id = args[0] || '';
    if (!id) { await bot.sendMessage(msg.chat.id, 'Usage: /approve &lt;approvalId&gt;'); return; }
    if (!team.canApprove(actorId)) {
      await bot.sendMessage(msg.chat.id, `❌ You don't have permission to approve operations.\nRole required: reviewer or owner.`);
      return;
    }
    const reqObj = pendingApprovals.get(id);
    if (!reqObj) { await bot.sendMessage(msg.chat.id, `Approval <code>${id}</code> not found or already handled.`); return; }
    pendingApprovals.delete(id);
    events.emit('approval_executed', 'info', { approvalId: id, actorId, app: reqObj.app, operation: reqObj.operation });
    const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload);
    await bot.sendMessage(msg.chat.id, `✅ <b>Approved and executed</b>\n${reqObj.app}/${reqObj.operation}\nResult: ${JSON.stringify(result).slice(0, 200)}`);
  });

  // /clear
  bot.command('clear', async (msg) => {
    convoMemory.clear(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'Conversation history cleared.');
  });

  // Natural language fallback → NLP → execute
  bot.onMessage(async (msg, text) => {
    const chatId = msg.chat.id;
    convoMemory.add(chatId, 'user', text);

    await bot.sendMessage(chatId, '🤔 Thinking...');
    const result = await nlp.parse(text);

    convoMemory.add(chatId, 'assistant', result.reply);

    if (!result.ok || !result.parsed) {
      await bot.sendMessage(chatId, result.reply);
      return;
    }

    const { app, operation, payload } = result.parsed;
    const workerId = getFirstWorker();

    if (!workerId) {
      await bot.sendMessage(chatId, `${result.reply}\n\n⚠️ No worker connected — can't execute. Start the local Adobe worker first.`);
      return;
    }

    const schema = getOperationSchema(app as any, operation);
    if (schema?.risk === 'high') {
      const approvalId = randomUUID();
      pendingApprovals.set(approvalId, { type: 'execute', requestId: randomUUID(), app: app as any, operation, payload, workerId, risk: 'high' });
      await bot.sendMessage(chatId,
        `${result.reply}\n\n⚠️ <b>High-risk operation</b> — approval required.\nApproval ID: <code>${approvalId}</code>\nA reviewer must run: /approve ${approvalId}`);
      return;
    }

    await bot.sendMessage(chatId, result.reply);
    const execResult: any = await dispatchToWorker(workerId, app as any, operation, payload);
    const ok = execResult?.ok ?? false;
    await bot.sendMessage(chatId, ok
      ? `✅ Done — ${operation} completed${execResult?.executionMode === 'mock' ? ' (mock mode)' : ''}`
      : `❌ Failed: ${execResult?.error || 'unknown error'}`);
  });

  // Start bot — polling if no public URL, webhook if CREATIVECLAW_PUBLIC_URL is set
  if (WEBHOOK_PUBLIC_URL) {
    bot.setWebhook(`${WEBHOOK_PUBLIC_URL}/telegram/inbound`, TELEGRAM_SECRET)
      .catch(err => console.error('[Telegram] Webhook registration failed:', err.message));
  } else {
    bot.startPolling()
      .catch(err => console.error('[Telegram] Polling failed to start:', err.message));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendTelegramMessage(text: string): Promise<void> {
  if (bot && TELEGRAM_CHAT_ID) {
    await bot.sendMessage(parseInt(TELEGRAM_CHAT_ID) || TELEGRAM_CHAT_ID as any, text).catch(() => {});
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf-8')));
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  });
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf-8')));
    req.on('end', () => resolve(body));
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Webhook callback when a job/operation completes
async function fireWebhook(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-creativeclaw-event': 'operation.completed' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[Webhook] Delivery failed:', url, err instanceof Error ? err.message : err);
  }
}

// ─── Worker dispatch ─────────────────────────────────────────────────────────

async function dispatchToWorker(
  workerId: string, app: WorkerExecute['app'], operation: string,
  payload?: Record<string, unknown>, webhookUrl?: string,
) {
  const worker = workers.get(workerId);
  if (!worker) return { ok: false, error: 'worker_not_found' };

  const requestId = randomUUID();
  const message: WorkerExecute = { type: 'execute', requestId, app, operation, payload };
  const start = Date.now();

  const result: any = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('worker_timeout')); }, 7000);
    pending.set(requestId, { resolve, reject, timeout });
    worker.ws.send(JSON.stringify(message));
  }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

  const durationMs = Date.now() - start;

  jobs.logOperation({
    app, operation, workerId,
    ok: result?.ok ?? false,
    payload: payload ? JSON.stringify(payload) : undefined,
    output: result?.output ? JSON.stringify(result.output) : undefined,
    error: result?.error,
    executionMode: result?.executionMode ?? 'mock',
    durationMs,
    timestamp: Date.now(),
  });

  if (webhookUrl) {
    await fireWebhook(webhookUrl, { app, operation, payload, result, durationMs, timestamp: Date.now() });
  }

  return result;
}

// Wire scheduler dispatch
scheduler.setDispatch(async (app, operation, payload, workerId) => {
  const wid = workerId || getFirstWorker() || '';
  return dispatchToWorker(wid as any, app as any, operation, payload);
});
scheduler.start();

tools.register({
  name: 'search_tools',
  description: 'Discover tools progressively by query and detail level',
  risk: 'low',
  schema: { query: 'string', detail_level: 'name_only|name_description|full_schema' },
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const projectId = (req.headers['x-project-id'] as string) || 'default';

  // ── Auth middleware ────────────────────────────────────────────────────────
  const authErr = auth.authenticate(req);
  if (authErr) { json(res, 401, { error: authErr, hint: 'Pass Authorization: Bearer <key> or set CREATIVECLAW_API_KEY env var' }); return; }

  // ── Core ──────────────────────────────────────────────────────────────────

  if (url.pathname === '/health') {
    events.emit('health_check');
    json(res, 200, { ok: true, app: 'creativeclaw-gateway', version: '0.8.0', uptime: Math.floor(process.uptime()), workers: workers.size, pendingApprovals: pendingApprovals.size });
    return;
  }

  if (url.pathname === '/events') { json(res, 200, { counters: events.counters(), recent: events.list(50) }); return; }

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

  if (url.pathname === '/tools') { json(res, 200, tools.list()); return; }

  // ── Auth key management ───────────────────────────────────────────────────

  if (url.pathname === '/auth/keys' && req.method === 'GET') { json(res, 200, auth.list()); return; }

  if (url.pathname === '/auth/keys' && req.method === 'POST') {
    const body = await readBody(req);
    const { label } = body;
    if (!label) { json(res, 400, { error: 'label required' }); return; }
    const { key, record } = auth.create(label);
    json(res, 201, { key, record, warning: 'Store this key — it will not be shown again.' });
    return;
  }

  if (url.pathname.startsWith('/auth/keys/') && req.method === 'DELETE') {
    const id = url.pathname.replace('/auth/keys/', '');
    json(res, 200, { ok: auth.revoke(id) });
    return;
  }

  // ── NLP / AI ──────────────────────────────────────────────────────────────

  if (url.pathname === '/ai/run' && req.method === 'POST') {
    const body = await readBody(req);
    const { text, workerId, webhookUrl } = body;
    if (!text) { json(res, 400, { error: 'text required' }); return; }

    const result = await nlp.parse(text, { projectId });
    if (!result.ok || !result.parsed) {
      json(res, 200, { ok: false, reply: result.reply, error: result.error });
      return;
    }

    const { app, operation, payload } = result.parsed;
    const wid = workerId || getFirstWorker();
    if (!wid) {
      json(res, 200, { ok: false, reply: result.reply, error: 'no_worker_connected' });
      return;
    }

    const schema = getOperationSchema(app as any, operation);
    if (schema?.risk === 'high') {
      const approvalId = randomUUID();
      pendingApprovals.set(approvalId, { type: 'execute', requestId: randomUUID(), app: app as any, operation, payload, workerId: wid, risk: 'high' });
      json(res, 202, { ok: false, needsApproval: true, approvalId, reply: result.reply, parsed: result.parsed });
      return;
    }

    events.emit('ai_run', 'info', { app, operation, confidence: result.parsed.confidence });
    const execResult = await dispatchToWorker(wid as any, app as any, operation, payload, webhookUrl);
    json(res, 200, { ok: true, reply: result.reply, parsed: result.parsed, result: execResult });
    return;
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  if (url.pathname === '/assets' && req.method === 'GET') {
    const app = (url.searchParams.get('app') as any) || null;
    const apps: Array<'premiere' | 'aftereffects' | 'photoshop' | 'illustrator'> =
      app ? [app] : ['premiere', 'aftereffects', 'photoshop', 'illustrator'];
    const results = await Promise.all(apps.map(a => browseAssets(a)));
    json(res, 200, { apps: results });
    return;
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  if (url.pathname === '/scheduler/jobs' && req.method === 'GET') { json(res, 200, scheduler.list()); return; }

  if (url.pathname === '/scheduler/jobs' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.label || !body.kind || !body.schedule || !body.app || !body.operation) {
      json(res, 400, { error: 'label, kind, schedule, app, operation required' }); return;
    }
    const job = scheduler.add({
      label: body.label, kind: body.kind, schedule: body.schedule,
      app: body.app, operation: body.operation,
      payload: typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload || {}),
      workerId: body.workerId, webhookUrl: body.webhookUrl, enabled: body.enabled !== false,
    });
    json(res, 201, job);
    return;
  }

  if (url.pathname.startsWith('/scheduler/jobs/') && req.method === 'PATCH') {
    const id = url.pathname.replace('/scheduler/jobs/', '');
    const body = await readBody(req);
    json(res, 200, scheduler.update(id, body) || { error: 'not_found' });
    return;
  }

  if (url.pathname.startsWith('/scheduler/jobs/') && req.method === 'DELETE') {
    const id = url.pathname.replace('/scheduler/jobs/', '');
    json(res, 200, { ok: scheduler.remove(id) });
    return;
  }

  // ── Team / RBAC ───────────────────────────────────────────────────────────

  if (url.pathname === '/team/users' && req.method === 'GET') { json(res, 200, team.list()); return; }

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
    json(res, 200, [...workers.entries()].map(([id, w]) => ({ workerId: id, capabilities: w.capabilities, lastSeen: w.lastSeen, idleSecs: Math.floor((Date.now() - w.lastSeen) / 1000) })));
    return;
  }

  // ── Worker execute ────────────────────────────────────────────────────────

  if (url.pathname === '/worker/execute' && req.method === 'POST') {
    const workerId = url.searchParams.get('workerId') || '';
    const app = url.searchParams.get('app') as WorkerExecute['app'];
    const operation = url.searchParams.get('operation') || '';
    const webhookUrl = url.searchParams.get('webhookUrl') || undefined;
    const body = await readBody(req);

    if (!workerId || !app || !operation) { json(res, 400, { ok: false, error: 'workerId, app, operation required' }); return; }

    const schema = getOperationSchema(app, operation);
    if (!schema) { json(res, 400, { ok: false, error: 'unknown_operation', app, operation }); return; }

    const validation = validateOperationPayload(schema, body);
    if (!validation.ok) { json(res, 400, { ok: false, error: 'invalid_payload', missing: validation.missing }); return; }

    if (schema.risk === 'high') {
      const approvalId = randomUUID();
      pendingApprovals.set(approvalId, { type: 'execute', requestId: randomUUID(), app, operation, payload: body, workerId, risk: schema.risk });
      await sendTelegramMessage(`⚠️ Approval required\nOp: ${operation} (${app})\nRisk: HIGH\nID: ${approvalId}`);
      json(res, 202, { ok: false, needsApproval: true, approvalId, risk: schema.risk });
      return;
    }

    events.emit('worker_execute', 'info', { workerId, app, operation, risk: schema.risk });
    const result = await dispatchToWorker(workerId, app, operation, body, webhookUrl);
    json(res, 200, result);
    return;
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  if (url.pathname === '/worker/approvals') {
    json(res, 200, [...pendingApprovals.entries()].map(([id, v]) => ({ approvalId: id, app: v.app, operation: v.operation, workerId: v.workerId, risk: v.risk })));
    return;
  }

  if (url.pathname === '/worker/approve' && req.method === 'POST') {
    const approvalId = url.searchParams.get('approvalId') || '';
    const actorId = url.searchParams.get('actorId') || '';
    const webhookUrl = url.searchParams.get('webhookUrl') || undefined;
    if (!actorId || !team.canApprove(actorId)) { json(res, 403, { ok: false, error: 'forbidden', message: 'actor lacks approval role' }); return; }
    const reqObj = pendingApprovals.get(approvalId);
    if (!reqObj) { json(res, 404, { ok: false, error: 'approval_not_found' }); return; }
    pendingApprovals.delete(approvalId);
    events.emit('approval_executed', 'info', { approvalId, actorId, app: reqObj.app, operation: reqObj.operation });
    const result = await dispatchToWorker(reqObj.workerId, reqObj.app, reqObj.operation, reqObj.payload, webhookUrl);
    json(res, 200, result);
    return;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  if (url.pathname === '/jobs' && req.method === 'GET') { json(res, 200, jobs.list()); return; }
  if (url.pathname === '/jobs/history') { json(res, 200, jobs.history({ limit: Math.min(parseInt(url.searchParams.get('limit') || '50'), 500), offset: parseInt(url.searchParams.get('offset') || '0'), status: url.searchParams.get('status') as any || undefined })); return; }
  if (url.pathname === '/jobs/operations') { json(res, 200, jobs.operationHistory(Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000), parseInt(url.searchParams.get('offset') || '0'))); return; }
  if (url.pathname === '/jobs/stats') { json(res, 200, jobs.stats()); return; }

  if (url.pathname === '/jobs/add' && req.method === 'POST') {
    const risk = (url.searchParams.get('risk') as any) || 'low';
    const name = url.searchParams.get('name') || 'unnamed_job';
    json(res, 200, jobs.add(name, risk));
    return;
  }

  if (url.pathname === '/jobs/approve' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    json(res, 200, jobs.approve(id) || { error: 'job_not_found' });
    return;
  }

  if (url.pathname === '/jobs/run' && req.method === 'POST') {
    const ran = await jobs.runNext(async (job) => {
      if (job.name.includes('fail')) throw new Error('Simulated failure');
      await sendTelegramMessage(`✅ Job done: ${job.name}`);
    });
    json(res, 200, ran || { status: 'no_queued_jobs' });
    return;
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  if (url.pathname === '/memory/demo') {
    memory.remember({ editType: 'trim_clip', projectId, confidence: 0.8, approved: true, timestamp: Date.now(), signals: { shotLength: 2.4 } });
    json(res, 200, memory.aggregate(projectId));
    return;
  }
  if (url.pathname === '/memory/profiles') { json(res, 200, memory.listProjects()); return; }
  if (url.pathname === '/memory/profile') {
    const pid = url.searchParams.get('projectId') || projectId;
    json(res, 200, { projectId: pid, aggregate: memory.aggregate(pid), signals: memory.recall(pid, 20) });
    return;
  }
  if (url.pathname === '/memory/stats') { json(res, 200, memory.stats()); return; }
  if (url.pathname === '/memory/remember' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId || !body.editType) { json(res, 400, { error: 'projectId and editType required' }); return; }
    memory.remember({ projectId: body.projectId || projectId, editType: body.editType, confidence: body.confidence ?? 0.5, approved: body.approved ?? false, timestamp: Date.now(), signals: body.signals ?? {} });
    json(res, 200, { ok: true });
    return;
  }

  // ── Connectors / Assets ───────────────────────────────────────────────────

  if (url.pathname === '/connectors/health') { json(res, 200, await connectors.health()); return; }

  // ── Search / APIs ─────────────────────────────────────────────────────────

  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') || 'creative automation';
    try { json(res, 200, { query: q, results: await search.search(q, 5) }); }
    catch (err) { json(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
    return;
  }

  if (url.pathname === '/apis') { json(res, 200, { templates: apis.listTemplates() }); return; }

  // ── Telegram inbound webhook ──────────────────────────────────────────────

  if (url.pathname === '/telegram/inbound' && req.method === 'POST') {
    const rawBody = await readRawBody(req);

    // Verify Telegram webhook secret
    const secretHeader = (req.headers['x-telegram-bot-api-secret-token'] as string) || '';
    if (WEBHOOK_PUBLIC_URL && secretHeader && secretHeader !== TELEGRAM_SECRET) {
      json(res, 403, { error: 'invalid_telegram_secret' });
      return;
    }

    try {
      const update = rawBody ? JSON.parse(rawBody) : {};
      if (bot) await bot.handleUpdate(update);
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
  } else { socket.destroy(); }
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
      const p = pending.get(result.requestId);
      if (p) { clearTimeout(p.timeout); p.resolve(result); pending.delete(result.requestId); }
      events.emit('worker_result', result.ok ? 'info' : 'warn', { requestId: result.requestId, ok: result.ok });
      if (workerId && workers.has(workerId)) workers.get(workerId)!.lastSeen = Date.now();
    }
  });
  ws.on('close', () => { if (workerId) { workers.delete(workerId); events.emit('worker_disconnected', 'warn', { workerId }); } });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[CreativeClaw] ${signal} — shutting down...`);
  scheduler.stop();
  if (bot) bot.stopPolling();
  for (const [id, p] of pending.entries()) { clearTimeout(p.timeout); p.reject(new Error('gateway_shutting_down')); pending.delete(id); }
  for (const [id, w] of workers.entries()) { w.ws.close(1001, 'Gateway shutting down'); workers.delete(id); }
  server.close(() => { console.log('[CreativeClaw] Stopped.'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(config.gateway.port, config.gateway.host, () => {
  console.log(`[CreativeClaw] Gateway v0.8.0 at http://${config.gateway.host}:${config.gateway.port}`);
  console.log(`[CreativeClaw] NLP: ${nlp.enabled ? 'Claude (Anthropic)' : 'rule-based fallback'}`);
  console.log(`[CreativeClaw] Telegram: ${bot ? (WEBHOOK_PUBLIC_URL ? 'webhook' : 'polling') : 'disabled'}`);
  console.log(`[CreativeClaw] Mock mode: ${process.env.CREATIVECLAW_ADOBE_MOCK ?? 'false'}`);
});
