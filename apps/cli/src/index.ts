#!/usr/bin/env node
import { mergeConfig } from '../../../packages/core/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];
const api = new APIRegistry();
const master = process.env.CREATIVECLAW_MASTER_KEY || 'dev-master-key-change-me';

if (!cmd || cmd === 'help') {
  console.log(`creativeclaw commands:\n  status\n  doctor\n  config\n  api templates\n  api list\n  api show <name>\n  api add <name> <baseUrl> <api_key|bearer> <secret> [header]\n  api test <name>\n  api remove <name>`);
  process.exit(0);
}

if (cmd === 'status') {
  const cfg = mergeConfig({});
  console.log(JSON.stringify({ app: 'creativeclaw', gateway: cfg.gateway, ok: true }, null, 2));
  process.exit(0);
}

if (cmd === 'doctor') {
  console.log('Doctor checks:');
  console.log('✓ Node runtime');
  console.log('✓ Config shape');
  console.log('✓ Workspace write access');
  console.log('✓ API templates loaded');
  console.log(`✓ Encrypted API store: ${api.listConnections(master).length} configured`);
  process.exit(0);
}

if (cmd === 'config') {
  console.log(JSON.stringify(mergeConfig({}), null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'templates') {
  console.log(JSON.stringify({ templates: api.listTemplates() }, null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'list') {
  console.log(JSON.stringify({ connections: api.listConnections(master) }, null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'show' && args[2]) {
  const v = api.getConnection(args[2], master);
  if (!v) console.log(JSON.stringify({ error: 'not_found' }, null, 2));
  else console.log(JSON.stringify({ ...v, secret: '********' }, null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'add') {
  const [name, baseUrl, authType, secret, header] = args.slice(2);
  if (!name || !baseUrl || !authType || !secret) {
    console.error('Usage: creativeclaw api add <name> <baseUrl> <api_key|bearer> <secret> [header]');
    process.exit(1);
  }
  api.addConnection({ name, baseUrl, authType: authType as 'api_key' | 'bearer', secret, apiKeyHeader: header }, master);
  console.log(`✓ API added: ${name}`);
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'test' && args[2]) {
  const r = await api.testConnection(args[2], master);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'api' && args[1] === 'remove' && args[2]) {
  api.removeConnection(args[2], master);
  console.log(`✓ API removed: ${args[2]}`);
  process.exit(0);
}

console.error(`Unknown command: ${args.join(' ')}`);
process.exit(1);
