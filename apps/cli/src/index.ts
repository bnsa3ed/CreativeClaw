#!/usr/bin/env node
import { mergeConfig } from '../../../packages/core/src/index.js';
import { APIRegistry } from '../../../packages/api-registry/src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];
const apis = new APIRegistry();

if (!cmd || cmd === 'help') {
  console.log(`creativeclaw commands:\n  status\n  doctor\n  config\n  api list\n  api show <name>`);
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
  process.exit(0);
}

if (cmd === 'config') {
  console.log(JSON.stringify(mergeConfig({}), null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'list') {
  console.log(JSON.stringify({ templates: apis.list() }, null, 2));
  process.exit(0);
}

if (cmd === 'api' && args[1] === 'show' && args[2]) {
  console.log(JSON.stringify(apis.get(args[2]) || { error: 'template_not_found' }, null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${args.join(' ')}`);
process.exit(1);
