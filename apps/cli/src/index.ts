#!/usr/bin/env node
/**
 * CreativeClaw CLI v0.9.0
 * Full command-line control over the gateway: execute operations, manage jobs,
 * approve requests, manage team, view assets, and configure schedules.
 */

import { mergeConfig } from '../../../packages/core/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

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

// ─── Interactive prompt helpers ───────────────────────────────────────────────

function rl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function prompt(question: string, defaultVal = ''): Promise<string> {
  return new Promise((resolve) => {
    const iface = rl();
    const display = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    iface.question(display, (answer) => {
      iface.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const iface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    process.stdout.write(`${question}: `);
    const chars: string[] = [];
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    // Try raw mode for hidden input (TTY only)
    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          iface.close();
          resolve(chars.join(''));
        } else if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        } else if (ch === '\u007f' || ch === '\b') {
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write('\b \b');
          }
        } else {
          chars.push(ch);
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } catch {
      // Not a TTY (piped input) — fall back to plain readline
      iface.close();
      const plain = readline.createInterface({ input: process.stdin, output: process.stdout });
      plain.question(`${question}: `, (answer) => {
        plain.close();
        resolve(answer.trim());
      });
    }
  });
}

async function promptYN(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await prompt(`${question} (${hint})`, defaultYes ? 'y' : 'n');
  return answer.toLowerCase().startsWith('y');
}

// ─── .env helpers ─────────────────────────────────────────────────────────────

function findProjectRoot(): string {
  // Walk up from cwd until we find package.json with name "creativeclaw"
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'creativeclaw' || pkg.workspaces) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function writeEnvFile(envPath: string, vars: Record<string, string>, comments: Record<string, string> = {}) {
  const lines: string[] = [
    '# CreativeClaw environment — generated by `creativeclaw setup`',
    '# Edit this file to change configuration. Never commit it to git.',
    '',
  ];
  for (const [key, val] of Object.entries(vars)) {
    if (comments[key]) lines.push(`# ${comments[key]}`);
    lines.push(`${key}=${val}`);
    lines.push('');
  }
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
}

function mergeEnvFile(envPath: string, newVars: Record<string, string>) {
  const existing = readEnvFile(envPath);
  writeEnvFile(envPath, { ...existing, ...newVars });
}

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
CreativeClaw CLI v0.9.0

USAGE: creativeclaw <command> [options]

SETUP
  setup                      Interactive first-time setup wizard ⭐

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

// ─── SETUP WIZARD ─────────────────────────────────────────────────────────────

if (cmd === 'setup') {
  const ROOT = findProjectRoot();
  const envPath = path.join(ROOT, '.env');
  const existing = readEnvFile(envPath);
  const envExists = fs.existsSync(envPath);

  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   CreativeClaw Setup Wizard  🎬           ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
  console.log('  This wizard will configure your CreativeClaw agent.');
  console.log(`  Settings will be saved to: ${envPath}\n`);

  if (envExists) {
    const overwrite = await promptYN('  An existing .env was found. Continue and update it?', true);
    if (!overwrite) { console.log('\n  Aborted. Your .env was not changed.\n'); process.exit(0); }
  }

  console.log('\n  ── Step 1 of 4: Telegram Bot ──────────────────\n');
  console.log('  Create a bot at https://t.me/BotFather → /newbot');
  console.log('  Then paste the token it gives you.\n');

  let botToken = existing.TELEGRAM_BOT_TOKEN || '';
  if (botToken) {
    console.log(`  Current token: ${botToken.slice(0, 8)}••••••••`);
    const keep = await promptYN('  Keep existing Telegram token?', true);
    if (!keep) botToken = '';
  }
  if (!botToken) {
    botToken = await promptSecret('  Telegram Bot Token');
    if (!botToken) die('  Telegram Bot Token is required.');
  }

  console.log('\n  ── Step 2 of 4: Your Telegram ID ──────────────\n');
  console.log('  This is your personal Telegram user ID (not username).');
  console.log('  Find it by messaging @userinfobot → it replies with your ID.\n');

  let ownerId = existing.CREATIVECLAW_OWNER_ID || '';
  if (ownerId) {
    console.log(`  Current owner ID: ${ownerId}`);
    const keep = await promptYN('  Keep existing owner ID?', true);
    if (!keep) ownerId = '';
  }
  if (!ownerId) {
    ownerId = await prompt('  Your Telegram User ID');
    if (!ownerId) die('  Telegram User ID is required.');
  }

  console.log('\n  ── Step 3 of 4: AI / NLP (Optional) ──────────\n');
  console.log('  An Anthropic API key enables natural language commands.');
  console.log('  Without it, only basic keyword matching is used.');
  console.log('  Get a key at https://console.anthropic.com\n');

  let anthropicKey = existing.ANTHROPIC_API_KEY || '';
  if (anthropicKey) {
    console.log(`  Current key: ${anthropicKey.slice(0, 8)}••••••••`);
    const keep = await promptYN('  Keep existing Anthropic key?', true);
    if (!keep) anthropicKey = '';
  }
  if (!anthropicKey) {
    anthropicKey = await promptSecret('  Anthropic API Key (press Enter to skip)');
  }

  console.log('\n  ── Step 4 of 4: Gateway Settings ──────────────\n');

  const portStr = await prompt('  Gateway port', existing.GATEWAY_PORT || '3789');
  const port = parseInt(portStr) || 3789;

  const mockMode = await promptYN(
    '  Enable Adobe mock mode? (Yes = safe testing without real Adobe apps)',
    existing.CREATIVECLAW_ADOBE_MOCK === 'true'
  );

  // ── Write .env ────────────────────────────────────────────────────────────

  console.log('\n  ── Saving configuration ────────────────────────\n');

  const newVars: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: botToken,
    CREATIVECLAW_OWNER_ID: ownerId,
    GATEWAY_PORT: String(port),
    CREATIVECLAW_ADOBE_MOCK: mockMode ? 'true' : 'false',
  };
  if (anthropicKey) newVars.ANTHROPIC_API_KEY = anthropicKey;

  writeEnvFile(envPath, newVars, {
    TELEGRAM_BOT_TOKEN: 'Bot token from @BotFather',
    CREATIVECLAW_OWNER_ID: 'Your Telegram user ID — gets owner role on first start',
    GATEWAY_PORT: 'HTTP gateway port',
    CREATIVECLAW_ADOBE_MOCK: 'true = no real Adobe needed (safe for testing)',
    ANTHROPIC_API_KEY: 'Enables NLP natural language → Adobe operation routing',
  });

  console.log(`  ✓ Written → ${envPath}`);

  // ── Verify bot token ──────────────────────────────────────────────────────

  console.log('\n  ── Verifying Telegram token ────────────────────\n');
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json: any = await res.json();
    if (json.ok) {
      console.log(`  ✓ Bot verified: @${json.result.username} (${json.result.first_name})`);
    } else {
      console.log(`  ⚠️  Token check failed: ${json.description}`);
      console.log('     You can fix this later by editing .env');
    }
  } catch {
    console.log('  ⚠️  Could not reach Telegram API — check your internet connection.');
    console.log('     Bot token saved anyway.');
  }

  // ── Start gateway ─────────────────────────────────────────────────────────

  const startGateway = await promptYN('\n  Start the CreativeClaw gateway now?', true);

  if (startGateway) {
    console.log('\n  Starting gateway...\n');

    const gatewayBin = path.join(ROOT, 'dist/apps/gateway/src/index.js');
    if (!fs.existsSync(gatewayBin)) {
      console.log('  ⚠️  Gateway not built yet. Run: pnpm build');
      console.log('  Then start with: node dist/apps/gateway/src/index.js\n');
    } else {
      // Start gateway as background process, load .env
      const child = spawn(process.execPath, [gatewayBin], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...readEnvFile(envPath) },
      });
      child.unref();

      // Give it 2s to boot, then check health
      console.log('  Waiting for gateway to boot...');
      await new Promise(r => setTimeout(r, 2500));

      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`);
        const json: any = await health.json();
        if (json?.ok) {
          console.log(`  ✓ Gateway is online at http://127.0.0.1:${port}`);

          // ── Auto-generate and save API key ──────────────────────────────────
          console.log('\n  ── Generating your API key ─────────────────────\n');
          try {
            const keyRes = await fetch(`http://127.0.0.1:${port}/auth/keys`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ label: 'default' }),
            });
            const keyJson: any = await keyRes.json();
            if (keyJson?.key) {
              mergeEnvFile(envPath, { CREATIVECLAW_API_KEY: keyJson.key });
              console.log(`  ✓ API key generated and saved to .env`);
              console.log(`  Key: ${keyJson.key}`);
            }
          } catch {
            console.log('  ⚠️  Could not auto-generate API key.');
            console.log('     Run: creativeclaw auth keys add --label default');
          }
        } else {
          console.log('  ⚠️  Gateway started but health check failed. Check logs.');
        }
      } catch {
        console.log('  ⚠️  Gateway did not respond in time.');
        console.log(`     Try manually: node ${gatewayBin}`);
      }
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   ✅  Setup complete!                     ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
  console.log('  Next steps:');
  console.log('    1. Message your bot on Telegram — try: /start');
  if (!startGateway) {
    console.log(`    2. Start the gateway:  node dist/apps/gateway/src/index.js`);
  }
  console.log('    3. Run health check:   creativeclaw doctor');
  console.log('    4. Execute an op:      creativeclaw run "export current frame as PNG"\n');

  if (!anthropicKey) {
    console.log('  💡 Tip: Add your Anthropic API key to .env for full NLP support.');
    console.log('     ANTHROPIC_API_KEY=sk-ant-...\n');
  }

  process.exit(0);
}

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
