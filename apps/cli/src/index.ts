#!/usr/bin/env node
/**
 * CreativeClaw CLI v0.8.0
 * Full command-line control over the gateway: execute operations, manage jobs,
 * approve requests, manage team, view assets, and configure schedules.
 */

import { mergeConfig } from '../../../packages/core/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

const api = new APIRegistry();
const config = mergeConfig({});
const GATEWAY = process.env.CREATIVECLAW_GATEWAY || `http://${config.gateway.host}:${config.gateway.port}`;
const API_KEY = process.env.CREATIVECLAW_API_KEY || '';
const master = process.env.CREATIVECLAW_MASTER_KEY || 'dev-master-key-change-me';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function gw(path: string, opts: { method?: string; body?: unknown } = {}): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (API_KEY) headers['authorization'] = `Bearer ${API_KEY}`;
  const res = await fetch(`${GATEWAY}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function out(data: unknown) { console.log(JSON.stringify(data, null, 2)); }
function die(msg: string, code = 1): never { console.error(`✗ ${msg}`); process.exit(code); }
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function hasFlag(name: string): boolean { return args.includes(`--${name}`); }

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
CreativeClaw CLI v0.8.0

USAGE: creativeclaw <command> [options]

GATEWAY COMMANDS
  status                     Gateway health + uptime
  doctor                     Run local diagnostics
  config                     Show resolved config
  workers                    List connected Adobe workers
  assets [--app <app>]       Browse open project assets

OPERATION COMMANDS
  execute <app> <operation>  Execute an Adobe operation
    --worker <id>              Target worker (default: first connected)
    --payload <json>           Operation payload as JSON string
    --webhook <url>            Callback URL when done
  run <text>                 Run a natural language command (NLP)
    --worker <id>
    --webhook <url>

JOB COMMANDS
  jobs                       List active job queue
  jobs history               Paginated job history
    --limit <n>                (default 20)
    --offset <n>               (default 0)
    --status <status>          Filter by status
  jobs ops                   Operation execution log
    --limit <n>
  jobs stats                 Job counts by status / risk
  jobs add --name <n> --risk <r>  Add a job
  jobs run                   Run next queued job

APPROVAL COMMANDS
  approvals                  List pending high-risk approvals
  approve <approvalId>       Approve a pending operation
    --actor <userId>           Acting user ID (required)

TEAM COMMANDS
  team                       List team members
  team add --user <id> --role <role>   Add/update member
  team remove --user <id>    Remove member

SCHEDULE COMMANDS
  schedule                   List scheduled jobs
  schedule add               Add a recurring job
    --label <name>             Job label (required)
    --kind <cron|interval|once>  Schedule type (required)
    --expr <expr>              Cron expr / interval ms / unix ms (required)
    --app <app>                Adobe app (required)
    --op <operation>           Operation name (required)
    --payload <json>           Payload JSON
    --webhook <url>            Callback URL
  schedule remove <id>       Remove a scheduled job
  schedule toggle <id>       Enable/disable a scheduled job

AUTH COMMANDS
  auth keys                  List API keys
  auth keys add --label <n>  Create new API key
  auth keys revoke <id>      Revoke an API key

API COMMANDS
  api templates              List API templates
  api list                   List configured connections
  api show <name>            Show connection (secret masked)
  api add <name> <url> <type> <secret> [header]
  api test <name>            Test a connection
  api remove <name>          Remove a connection

MEMORY COMMANDS
  memory profiles            List style memory projects
  memory profile --project <id>   Show project profile
  memory stats               Memory statistics

ENVIRONMENT
  CREATIVECLAW_GATEWAY       Gateway URL (default: http://127.0.0.1:3789)
  CREATIVECLAW_API_KEY       API key for authentication
  CREATIVECLAW_MASTER_KEY    Master key for local API store
`;

// ─── Commands ─────────────────────────────────────────────────────────────────

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}

// status
if (cmd === 'status') {
  const data = await gw('/health');
  const workers = await gw('/workers');
  console.log(`CreativeClaw Gateway — ${data?.ok ? '✅ Online' : '❌ Offline'}`);
  console.log(`  Version:   ${data?.version || '—'}`);
  console.log(`  Uptime:    ${data?.uptime ? Math.floor(data.uptime / 3600) + 'h ' + Math.floor((data.uptime % 3600) / 60) + 'm' : '—'}`);
  console.log(`  Workers:   ${workers?.length ?? 0}`);
  console.log(`  Approvals: ${data?.pendingApprovals ?? 0} pending`);
  console.log(`  Gateway:   ${GATEWAY}`);
  process.exit(0);
}

// doctor
if (cmd === 'doctor') {
  console.log('CreativeClaw Doctor\n');
  const checks: [string, () => Promise<boolean>][] = [
    ['Node.js 22+', async () => parseInt(process.version.slice(1)) >= 22],
    ['Config valid', async () => !!config.gateway.port],
    ['Gateway reachable', async () => { try { const r = await gw('/health'); return r?.ok; } catch { return false; } }],
    ['API key set', async () => !!API_KEY || !!process.env.CREATIVECLAW_API_KEY],
    ['Workers connected', async () => { const w = await gw('/workers').catch(() => []); return (w?.length ?? 0) > 0; }],
    ['Telegram bot token', async () => !!process.env.TELEGRAM_BOT_TOKEN],
    ['Anthropic API key', async () => !!process.env.ANTHROPIC_API_KEY],
    ['Adobe mock mode', async () => process.env.CREATIVECLAW_ADOBE_MOCK === 'true'],
  ];
  let allOk = true;
  for (const [label, check] of checks) {
    const ok = await check().catch(() => false);
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok && label !== 'Adobe mock mode' && label !== 'Anthropic API key' && label !== 'Telegram bot token') allOk = false;
  }
  console.log(`\n${allOk ? '✅ All critical checks passed' : '⚠️  Some checks failed — see above'}`);
  process.exit(allOk ? 0 : 1);
}

// config
if (cmd === 'config') { out(config); process.exit(0); }

// workers
if (cmd === 'workers') {
  const workers = await gw('/workers');
  if (!workers?.length) { console.log('No workers connected.'); process.exit(0); }
  for (const w of workers) {
    console.log(`  ${w.workerId}  caps: ${w.capabilities?.join(', ')}  idle: ${w.idleSecs}s`);
  }
  process.exit(0);
}

// assets
if (cmd === 'assets') {
  const app = flag('app') || '';
  const data = await gw(`/assets${app ? `?app=${app}` : ''}`);
  for (const r of data?.apps || []) {
    if (r.error || !r.items?.length) continue;
    console.log(`\n${r.app} — ${r.projectName || 'untitled'} (active: ${r.activeItem || '—'})`);
    r.items.slice(0, 20).forEach((item: any) => console.log(`  • ${item.name}  [${item.type}]${item.duration ? '  ' + item.duration : ''}`));
    if (r.items.length > 20) console.log(`  … +${r.items.length - 20} more`);
  }
  process.exit(0);
}

// execute
if (cmd === 'execute') {
  const app = args[1]; const operation = args[2];
  if (!app || !operation) die('Usage: creativeclaw execute <app> <operation> [--worker <id>] [--payload <json>] [--webhook <url>]');
  const workers = await gw('/workers');
  const workerId = flag('worker') || workers?.[0]?.workerId;
  if (!workerId) die('No worker connected. Start the local worker first.');
  const payloadStr = flag('payload') || '{}';
  let payload: any;
  try { payload = JSON.parse(payloadStr); } catch { die('Invalid --payload JSON'); }
  const webhookParam = flag('webhook') ? `&webhookUrl=${encodeURIComponent(flag('webhook')!)}` : '';
  const result = await gw(`/worker/execute?workerId=${workerId}&app=${app}&operation=${operation}${webhookParam}`, { method: 'POST', body: payload });
  out(result);
  process.exit(result?.ok ? 0 : 1);
}

// run (NLP)
if (cmd === 'run') {
  const text = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
  if (!text) die('Usage: creativeclaw run "trim clip intro from 5s to 30s"');
  const webhookUrl = flag('webhook');
  const workerId = flag('worker');
  const result = await gw('/ai/run', { method: 'POST', body: { text, workerId, webhookUrl } });
  console.log(`\n${result?.reply || JSON.stringify(result)}`);
  if (result?.result) { console.log('\nResult:'); out(result.result); }
  process.exit(result?.ok ? 0 : 1);
}

// jobs
if (cmd === 'jobs') {
  if (!sub || sub === 'list') {
    out(await gw('/jobs'));
  } else if (sub === 'history') {
    const limit = flag('limit') || '20'; const offset = flag('offset') || '0';
    const status = flag('status') ? `&status=${flag('status')}` : '';
    out(await gw(`/jobs/history?limit=${limit}&offset=${offset}${status}`));
  } else if (sub === 'ops' || sub === 'operations') {
    out(await gw(`/jobs/operations?limit=${flag('limit') || '50'}`));
  } else if (sub === 'stats') {
    out(await gw('/jobs/stats'));
  } else if (sub === 'add') {
    const name = flag('name'); const risk = flag('risk') || 'low';
    if (!name) die('--name required');
    out(await gw(`/jobs/add?name=${encodeURIComponent(name)}&risk=${risk}`, { method: 'POST' }));
  } else if (sub === 'run') {
    out(await gw('/jobs/run', { method: 'POST' }));
  } else { die(`Unknown jobs subcommand: ${sub}`); }
  process.exit(0);
}

// approvals
if (cmd === 'approvals') {
  out(await gw('/worker/approvals'));
  process.exit(0);
}

// approve
if (cmd === 'approve') {
  const approvalId = args[1];
  if (!approvalId) die('Usage: creativeclaw approve <approvalId> --actor <userId>');
  const actorId = flag('actor');
  if (!actorId) die('--actor <userId> required');
  const webhookParam = flag('webhook') ? `&webhookUrl=${encodeURIComponent(flag('webhook')!)}` : '';
  out(await gw(`/worker/approve?approvalId=${approvalId}&actorId=${actorId}${webhookParam}`, { method: 'POST' }));
  process.exit(0);
}

// team
if (cmd === 'team') {
  if (!sub || sub === 'list') {
    const users = await gw('/team/users');
    if (!users?.length) { console.log('No team members.'); process.exit(0); }
    for (const u of users) console.log(`  ${u.userId}  role: ${u.role}`);
  } else if (sub === 'add') {
    const userId = flag('user'); const role = flag('role');
    if (!userId || !role) die('--user <id> --role <role> required');
    out(await gw('/team/users', { method: 'POST', body: { userId, role } }));
  } else if (sub === 'remove') {
    const userId = flag('user');
    if (!userId) die('--user <id> required');
    out(await gw(`/team/users?userId=${userId}`, { method: 'DELETE' }));
  } else { die(`Unknown team subcommand: ${sub}`); }
  process.exit(0);
}

// schedule
if (cmd === 'schedule') {
  if (!sub || sub === 'list') {
    const jobs = await gw('/scheduler/jobs');
    if (!jobs?.length) { console.log('No scheduled jobs.'); process.exit(0); }
    for (const j of jobs) {
      console.log(`  [${j.enabled ? '✓' : '✗'}] ${j.id}  "${j.label}"  ${j.kind}:${j.schedule}  ${j.app}/${j.operation}  runs:${j.runCount}`);
    }
  } else if (sub === 'add') {
    const label = flag('label'); const kind = flag('kind'); const expr = flag('expr');
    const app = flag('app'); const operation = flag('op');
    if (!label || !kind || !expr || !app || !operation) die('--label --kind --expr --app --op all required');
    const payload = flag('payload') ? JSON.parse(flag('payload')!) : {};
    out(await gw('/scheduler/jobs', { method: 'POST', body: { label, kind, schedule: expr, app, operation, payload, webhookUrl: flag('webhook'), enabled: true } }));
  } else if (sub === 'remove') {
    const id = args[2]; if (!id) die('Usage: creativeclaw schedule remove <id>');
    out(await gw(`/scheduler/jobs/${id}`, { method: 'DELETE' }));
  } else if (sub === 'toggle') {
    const id = args[2]; if (!id) die('Usage: creativeclaw schedule toggle <id>');
    const jobs = await gw('/scheduler/jobs');
    const job = jobs?.find((j: any) => j.id === id);
    if (!job) die(`Job ${id} not found`);
    out(await gw(`/scheduler/jobs/${id}`, { method: 'PATCH', body: { enabled: !job.enabled } }));
  } else { die(`Unknown schedule subcommand: ${sub}`); }
  process.exit(0);
}

// auth
if (cmd === 'auth') {
  if (sub === 'keys' && !args[2]) {
    out(await gw('/auth/keys'));
  } else if (sub === 'keys' && args[2] === 'add') {
    const label = flag('label') || args[3];
    if (!label) die('--label required');
    const res = await gw('/auth/keys', { method: 'POST', body: { label } });
    console.log(`\n✅ Key created for "${label}":`);
    console.log(`  Key: ${res.key}`);
    console.log(`  ID:  ${res.record?.id}`);
    console.log(`\n  ⚠️  Save this key — it will not be shown again.`);
    console.log(`  Add to .env: CREATIVECLAW_API_KEY=${res.key}`);
  } else if (sub === 'keys' && args[2] === 'revoke') {
    const id = args[3]; if (!id) die('Usage: creativeclaw auth keys revoke <id>');
    out(await gw(`/auth/keys/${id}`, { method: 'DELETE' }));
  } else { die(`Usage: creativeclaw auth keys [add --label <n> | revoke <id>]`); }
  process.exit(0);
}

// memory
if (cmd === 'memory') {
  if (!sub || sub === 'profiles') {
    out(await gw('/memory/profiles'));
  } else if (sub === 'profile') {
    const project = flag('project'); if (!project) die('--project <id> required');
    out(await gw(`/memory/profile?projectId=${encodeURIComponent(project)}`));
  } else if (sub === 'stats') {
    out(await gw('/memory/stats'));
  } else { die(`Unknown memory subcommand: ${sub}`); }
  process.exit(0);
}

// api commands
if (cmd === 'api') {
  if (sub === 'templates') { out({ templates: api.listTemplates() }); }
  else if (sub === 'list') { out({ connections: api.listConnections(master) }); }
  else if (sub === 'show' && args[2]) {
    const v = api.getConnection(args[2], master);
    if (!v) die('Not found'); out({ ...v, secret: '********' });
  } else if (sub === 'add') {
    const [name, baseUrl, authType, secret, header] = args.slice(2);
    if (!name || !baseUrl || !authType || !secret) die('Usage: creativeclaw api add <name> <baseUrl> <api_key|bearer> <secret> [header]');
    api.addConnection({ name, baseUrl, authType: authType as any, secret, apiKeyHeader: header }, master);
    console.log(`✓ API added: ${name}`);
  } else if (sub === 'test' && args[2]) {
    const r = await api.testConnection(args[2], master);
    out(r); process.exit(r.ok ? 0 : 1);
  } else if (sub === 'remove' && args[2]) {
    api.removeConnection(args[2], master); console.log(`✓ Removed: ${args[2]}`);
  } else { die(`Unknown api subcommand: ${sub}`); }
  process.exit(0);
}

console.error(`Unknown command: ${args.join(' ')}\nRun 'creativeclaw help' for usage.`);
process.exit(1);
