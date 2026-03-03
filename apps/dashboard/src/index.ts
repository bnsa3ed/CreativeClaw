/**
 * CreativeClaw Dashboard — Phase 9
 * Real-time operations dashboard with auto-refresh, job history,
 * team management, approval queue, memory profiles, and live metrics.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = Number(process.env.CREATIVECLAW_DASHBOARD_PORT || 3790);
const GATEWAY = process.env.CREATIVECLAW_GATEWAY_BASE || 'http://127.0.0.1:3789';
const REFRESH_MS = Number(process.env.CREATIVECLAW_DASHBOARD_REFRESH || 5000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const API_KEY = process.env.CREATIVECLAW_API_KEY || '';
const AUTH_HEADERS: Record<string, string> = API_KEY ? { authorization: `Bearer ${API_KEY}` } : {};

async function fetchJson(path: string): Promise<any> {
  try {
    const r = await fetch(`${GATEWAY}${path}`, { headers: AUTH_HEADERS });
    return r.json();
  } catch {
    return null;
  }
}

async function fetchText(path: string): Promise<string> {
  try {
    const r = await fetch(`${GATEWAY}${path}`, { headers: AUTH_HEADERS });
    return r.text();
  } catch {
    return '';
  }
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { hour12: false });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    done: '#22c55e', failed: '#ef4444', running: '#f59e0b',
    queued: '#60a5fa', needs_approval: '#a78bfa', healthy: '#22c55e',
  };
  const color = colors[status] || '#94a3b8';
  return `<span style="background:${color}22;color:${color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">${status}</span>`;
}

function riskBadge(risk: string): string {
  const colors: Record<string, string> = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  const c = colors[risk] || '#94a3b8';
  return `<span style="color:${c};font-size:11px">▲ ${risk}</span>`;
}

function modeBadge(mode: string): string {
  return mode === 'real'
    ? `<span style="color:#22c55e;font-size:11px">● real</span>`
    : `<span style="color:#94a3b8;font-size:11px">◎ mock</span>`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p style="color:#475569;font-size:13px">No records.</p>';
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="border-bottom:1px solid #1e293b">
          ${headers.map(h => `<th style="text-align:left;padding:6px 10px;color:#64748b;font-weight:600;white-space:nowrap">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `<tr style="border-bottom:1px solid #0f172a">
          ${r.map(c => `<td style="padding:6px 10px;color:#cbd5e1;vertical-align:middle">${c}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function html(data: Record<string, any>): string {
  const {
    health, workers, events, metricsText,
    jobHistory, opHistory, jobStats,
    teamUsers, approvals, memProfiles, memStats,
    connectorHealth, scheduledJobs, authKeys, assets,
  } = data;

  const ok = !!health?.ok;
  const uptime = health?.uptime ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '—';

  // Workers table
  const workerRows = (workers || []).map((w: any) => [
    `<code style="color:#7dd3fc">${w.workerId}</code>`,
    w.capabilities?.join(', ') || '—',
    `${w.idleSecs ?? '?'}s ago`,
  ]);

  // Adobe connectors
  const connRows = (connectorHealth || []).map((c: any) => [
    c.app,
    c.running ? statusBadge('healthy') : statusBadge('offline'),
    modeBadge(c.executionMode),
    `<span style="color:#64748b;font-size:11px">${c.message || ''}</span>`,
  ]);

  // Pending approvals
  const approvalRows = (approvals || []).map((a: any) => [
    `<code style="font-size:11px;color:#f59e0b">${a.approvalId?.slice(0, 8)}…</code>`,
    a.app, a.operation,
    riskBadge(a.risk),
    `<code style="color:#94a3b8;font-size:11px">${a.workerId}</code>`,
  ]);

  // Job history
  const jobRows = ((jobHistory?.jobs || []) as any[]).slice(0, 30).map((j: any) => [
    `<code style="font-size:11px;color:#94a3b8">${j.id?.slice(0, 14)}…</code>`,
    j.name,
    statusBadge(j.status),
    riskBadge(j.risk),
    String(j.attempts),
    fmtTime(j.createdAt),
    j.lastError ? `<span style="color:#ef4444;font-size:11px">${String(j.lastError).slice(0, 60)}</span>` : '—',
  ]);

  // Operation log
  const opRows = ((opHistory?.ops || []) as any[]).slice(0, 25).map((o: any) => [
    fmtTime(o.timestamp),
    o.app,
    o.operation,
    o.ok ? statusBadge('done') : statusBadge('failed'),
    modeBadge(o.executionMode),
    fmtDuration(o.durationMs || 0),
    o.error ? `<span style="color:#ef4444;font-size:11px">${String(o.error).slice(0, 60)}</span>` : '—',
  ]);

  // Team
  const teamRows = (teamUsers || []).map((u: any) => [
    `<code>${u.userId}</code>`,
    u.role,
    fmtTime(u.addedAt),
  ]);

  // Memory profiles
  const memRows = (memProfiles || []).map((p: any) => [
    `<code style="color:#7dd3fc">${p.projectId}</code>`,
    String(p.signalCount),
    String(p.avgConfidence?.toFixed(2)),
    (p.topEditTypes || []).join(', ') || '—',
    fmtTime(p.lastActivity),
  ]);

  // Event counters
  const eventCounters = events?.counters || {};
  const eventRows = Object.entries(eventCounters).map(([k, v]) => [k, String(v)]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>CreativeClaw Dashboard</title>
  <meta http-equiv="refresh" content="${REFRESH_MS / 1000}"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#020817;color:#e2e8f0;min-height:100vh}
    a{color:#60a5fa;text-decoration:none}
    .topbar{background:#0b1120;border-bottom:1px solid #1e293b;padding:12px 24px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:10}
    .logo{font-size:18px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px}
    .logo span{color:#6366f1}
    .badge{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
    .badge.ok{background:#16a34a22;color:#4ade80}
    .badge.err{background:#dc262622;color:#f87171}
    .meta{color:#475569;font-size:12px;margin-left:auto}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
    .stat{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px}
    .stat .val{font-size:28px;font-weight:700;color:#f8fafc;line-height:1}
    .stat .lbl{font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:20px}
    .card h2{font-size:14px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .card h2 .dot{width:8px;height:8px;border-radius:50%;background:#6366f1}
    .main{max-width:1400px;margin:0 auto;padding:24px}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    @media(max-width:900px){.cols{grid-template-columns:1fr}}
    .refresh{color:#475569;font-size:11px}
    pre{color:#7dd3fc;font-size:11px;overflow:auto;max-height:200px;padding:10px;background:#020817;border-radius:6px}
    .empty{color:#334155;font-size:13px;padding:12px 0}
  </style>
</head>
<body>
<div class="topbar">
  <div class="logo">Creative<span>Claw</span></div>
  <span class="badge ${ok ? 'ok' : 'err'}">${ok ? '● Online' : '✕ Offline'}</span>
  <span style="color:#475569;font-size:12px">Uptime: ${uptime}</span>
  <span style="color:#475569;font-size:12px">Workers: ${health?.workers ?? 0}</span>
  <span style="color:#475569;font-size:12px">Approvals pending: ${health?.pendingApprovals ?? 0}</span>
  <span class="meta refresh">Auto-refresh ${REFRESH_MS / 1000}s · ${new Date().toLocaleTimeString()}</span>
</div>

<div class="main">

  <!-- Stats Row -->
  <div class="grid">
    <div class="stat"><div class="val">${jobStats?.total ?? 0}</div><div class="lbl">Total Jobs</div></div>
    <div class="stat"><div class="val" style="color:#22c55e">${jobStats?.byStatus?.done ?? 0}</div><div class="lbl">Done</div></div>
    <div class="stat"><div class="val" style="color:#ef4444">${jobStats?.byStatus?.failed ?? 0}</div><div class="lbl">Failed</div></div>
    <div class="stat"><div class="val" style="color:#f59e0b">${(approvals || []).length}</div><div class="lbl">Awaiting Approval</div></div>
    <div class="stat"><div class="val">${health?.workers ?? 0}</div><div class="lbl">Workers Online</div></div>
    <div class="stat"><div class="val">${memStats?.totalSignals ?? 0}</div><div class="lbl">Memory Signals</div></div>
    <div class="stat"><div class="val">${memStats?.projects ?? 0}</div><div class="lbl">Projects</div></div>
    <div class="stat"><div class="val">${opHistory?.total ?? 0}</div><div class="lbl">Operations Logged</div></div>
    <div class="stat"><div class="val">${(scheduledJobs || []).filter((j: any) => j.enabled).length}</div><div class="lbl">Active Schedules</div></div>
    <div class="stat"><div class="val">${(authKeys || []).length}</div><div class="lbl">API Keys</div></div>
  </div>

  <div class="cols">
    <!-- Left column -->
    <div>

      <!-- Adobe Connectors -->
      <div class="card">
        <h2><span class="dot" style="background:#818cf8"></span>Adobe Connectors</h2>
        ${table(['App', 'Status', 'Mode', 'Message'], connRows)}
      </div>

      <!-- Workers -->
      <div class="card">
        <h2><span class="dot" style="background:#34d399"></span>Connected Workers</h2>
        ${table(['Worker ID', 'Capabilities', 'Last Seen'], workerRows)}
      </div>

      <!-- Pending Approvals -->
      <div class="card">
        <h2><span class="dot" style="background:#fbbf24"></span>Pending Approvals</h2>
        ${approvalRows.length
          ? table(['ID', 'App', 'Operation', 'Risk', 'Worker'], approvalRows)
          : '<p class="empty">No pending approvals.</p>'}
      </div>

      <!-- Team -->
      <div class="card">
        <h2><span class="dot" style="background:#a78bfa"></span>Team Members</h2>
        ${table(['User ID', 'Role', 'Added'], teamRows)}
      </div>

    </div>

    <!-- Right column -->
    <div>

      <!-- Operation History -->
      <div class="card">
        <h2><span class="dot" style="background:#f472b6"></span>Operation History <span style="color:#334155;font-weight:400">(last 25)</span></h2>
        ${table(['Time', 'App', 'Operation', 'Status', 'Mode', 'Duration', 'Error'], opRows)}
      </div>

      <!-- Job History -->
      <div class="card">
        <h2><span class="dot" style="background:#38bdf8"></span>Job Queue History <span style="color:#334155;font-weight:400">(last 30)</span></h2>
        ${table(['ID', 'Name', 'Status', 'Risk', 'Attempts', 'Created', 'Error'], jobRows)}
      </div>

    </div>
  </div>

  <!-- Memory Profiles + Events row -->
  <div class="cols">

    <div class="card">
      <h2><span class="dot" style="background:#fb923c"></span>Style Memory Profiles</h2>
      ${table(['Project', 'Signals', 'Avg Conf', 'Top Edits', 'Last Activity'], memRows)}
    </div>

    <div class="card">
      <h2><span class="dot" style="background:#94a3b8"></span>Event Counters</h2>
      ${table(['Event', 'Count'], eventRows)}
    </div>

  </div>

  <!-- Scheduler + Auth + Assets row -->
  <div class="cols">

    <div class="card">
      <h2><span class="dot" style="background:#f97316"></span>Scheduled Jobs</h2>
      ${table(
        ['Label', 'Kind', 'Schedule', 'App / Op', 'Runs', 'Next Run', 'Status'],
        ((scheduledJobs || []) as any[]).map((j: any) => [
          j.label,
          j.kind,
          `<code style="font-size:10px">${j.schedule}</code>`,
          `${j.app}/${j.operation}`,
          String(j.runCount ?? 0),
          j.nextRunAt ? fmtTime(j.nextRunAt) : '—',
          j.enabled ? statusBadge('healthy') : `<span style="color:#475569;font-size:11px">disabled</span>`,
        ])
      )}
    </div>

    <div class="card">
      <h2><span class="dot" style="background:#ec4899"></span>API Keys</h2>
      ${table(
        ['Label', 'ID', 'Created', 'Last Used'],
        ((authKeys || []) as any[]).map((k: any) => [
          k.label,
          `<code style="font-size:10px">${k.id}</code>`,
          fmtTime(k.createdAt),
          k.lastUsedAt ? fmtTime(k.lastUsedAt) : '<span style="color:#475569">never</span>',
        ])
      )}
    </div>

  </div>

  <!-- Open Assets -->
  <div class="card">
    <h2><span class="dot" style="background:#14b8a6"></span>Open Adobe Assets</h2>
    ${(() => {
      const appResults: any[] = assets?.apps || [];
      const active = appResults.filter((r: any) => r.items?.length > 0);
      if (!active.length) return '<p class="empty">No open Adobe projects detected.</p>';
      return active.map((r: any) =>
        `<div style="margin-bottom:12px">
          <div style="color:#94a3b8;font-size:12px;font-weight:600;margin-bottom:6px">${r.app} — ${r.projectName || 'untitled'} ${r.activeItem ? `<span style="color:#60a5fa">(active: ${r.activeItem})</span>` : ''}</div>
          ${table(['Name', 'Type', 'Duration/Size'], r.items.slice(0, 10).map((item: any) => [
            `<code style="font-size:11px">${item.name}</code>`,
            item.type,
            item.duration || (item.width ? `${item.width}×${item.height}` : '—'),
          ]))}
        </div>`
      ).join('');
    })()}
  </div>

  <!-- Prometheus Metrics -->
  <div class="card">
    <h2><span class="dot" style="background:#6366f1"></span>Prometheus Metrics</h2>
    <pre>${metricsText || 'Unavailable'}</pre>
  </div>

</div>
</body>
</html>`;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (_req: IncomingMessage, res: ServerResponse) => {
  try {
    const [
      health, workers, events, metricsText,
      jobHistory, opHistory, jobStats,
      teamUsers, approvals, memProfiles, memStats,
      connectorHealth, scheduledJobs, authKeys, assets,
    ] = await Promise.all([
      fetchJson('/health'),
      fetchJson('/workers'),
      fetchJson('/events'),
      fetchText('/metrics'),
      fetchJson('/jobs/history?limit=30'),
      fetchJson('/jobs/operations?limit=25'),
      fetchJson('/jobs/stats'),
      fetchJson('/team/users'),
      fetchJson('/worker/approvals'),
      fetchJson('/memory/profiles'),
      fetchJson('/memory/stats'),
      fetchJson('/connectors/health'),
      fetchJson('/scheduler/jobs'),
      fetchJson('/auth/keys'),
      fetchJson('/assets'),
    ]);

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html({
      health, workers, events, metricsText,
      jobHistory, opHistory, jobStats,
      teamUsers, approvals, memProfiles, memStats,
      connectorHealth, scheduledJobs, authKeys, assets,
    }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(e instanceof Error ? e.message : String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[CreativeClaw] Dashboard at http://127.0.0.1:${PORT}`);
  console.log(`[CreativeClaw] Gateway: ${GATEWAY} · Refresh: ${REFRESH_MS / 1000}s`);
});
