import { createServer } from 'node:http';
import { mergeConfig } from '../../../packages/core/src/index.js';
import { ToolRegistry } from '../../../packages/tool-registry/src/index.js';
import { MemoryStore } from '../../../packages/memory/src/index.js';
import { AdobeConnectorHub } from '../../../packages/connectors-adobe/src/index.js';
import { BraveSearchClient } from '../../../packages/search/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';
import { JobQueue } from '../../../packages/jobs/src/index.js';

const config = mergeConfig({});
const tools = new ToolRegistry();
const memory = new MemoryStore();
const connectors = new AdobeConnectorHub();
const search = new BraveSearchClient(process.env.BRAVE_SEARCH_API_KEY);
const apis = new APIRegistry();
const jobs = new JobQueue();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
  });
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
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'creativeclaw-gateway' }));
    return;
  }

  if (url.pathname === '/tools') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tools.list()));
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
    memory.remember({ editType: 'trim_clip', projectId: 'demo', confidence: 0.8, timestamp: Date.now(), signals: { shotLength: 2.4 } });
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
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const update = JSON.parse(body || '{}');
        const text = (update?.message?.text || '').trim();

        if (text === '/start') {
          await sendTelegramMessage('CreativeClaw is online ✅');
        } else if (text === '/status') {
          await sendTelegramMessage('Status: healthy, queue ready, connectors loaded.');
        } else if (text.startsWith('/run-job')) {
          const name = text.replace('/run-job', '').trim() || 'telegram_job';
          const job = jobs.add(name, 'low');
          await jobs.runNext(async () => {});
          await sendTelegramMessage(`Job executed: ${job.name}`);
        } else if (text) {
          await sendTelegramMessage(`CreativeClaw received: ${text}`);
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(config.gateway.port, config.gateway.host, () => {
  console.log(`CreativeClaw gateway running at http://${config.gateway.host}:${config.gateway.port}`);
});
