import { createServer } from 'node:http';

const PORT = Number(process.env.CREATIVECLAW_DASHBOARD_PORT || 3790);
const GATEWAY = process.env.CREATIVECLAW_GATEWAY_BASE || 'http://127.0.0.1:3789';

const html = (stats: any) => `<!doctype html>
<html><head><meta charset="utf-8"/><title>CreativeClaw Dashboard</title>
<style>body{font-family:system-ui;padding:24px;background:#0b1020;color:#e7ecff}.card{background:#131a33;padding:16px;border-radius:12px;margin:12px 0}code{color:#8ad}</style>
</head><body>
<h1>CreativeClaw Dashboard (Phase 4)</h1>
<div class="card"><h3>Gateway Health</h3><pre>${JSON.stringify(stats.health,null,2)}</pre></div>
<div class="card"><h3>Workers</h3><pre>${JSON.stringify(stats.workers,null,2)}</pre></div>
<div class="card"><h3>Events</h3><pre>${JSON.stringify(stats.events,null,2)}</pre></div>
<div class="card"><h3>Metrics</h3><pre>${stats.metrics}</pre></div>
<p>Gateway: <code>${GATEWAY}</code></p>
</body></html>`;

async function fetchJson(path: string) {
  const r = await fetch(`${GATEWAY}${path}`);
  return r.json();
}

const server = createServer(async (_req, res) => {
  try {
    const [health, workers, events, metricsText] = await Promise.all([
      fetchJson('/health'),
      fetchJson('/workers'),
      fetchJson('/events'),
      fetch(`${GATEWAY}/metrics`).then(r => r.text())
    ]);

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html({ health, workers, events, metrics: metricsText }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(e instanceof Error ? e.message : String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CreativeClaw dashboard at http://127.0.0.1:${PORT}`);
});
