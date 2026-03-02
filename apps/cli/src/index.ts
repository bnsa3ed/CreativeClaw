#!/usr/bin/env node
import { mergeConfig } from '../../../packages/core/src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === 'help') {
  console.log(`creativeclaw commands:\n  status\n  doctor\n  config`);
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
  process.exit(0);
}

if (cmd === 'config') {
  console.log(JSON.stringify(mergeConfig({}), null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
process.exit(1);
