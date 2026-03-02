import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

const gateway = spawn('node', ['dist/apps/gateway/src/index.js'], { stdio: 'ignore' });
await wait(800);
const worker = spawn('node', ['dist/apps/worker-local/src/index.js'], { stdio: 'ignore' });
await wait(1000);

const workers = await fetch('http://127.0.0.1:3789/workers').then(r=>r.json());
assert.ok(Array.isArray(workers) && workers.length > 0, 'worker should register');
const wid = workers[0].workerId;

const invalid = await fetch(`http://127.0.0.1:3789/worker/execute?workerId=${wid}&app=premiere&operation=trim_clip`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' }).then(r=>r.json());
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'invalid_payload');

const valid = await fetch(`http://127.0.0.1:3789/worker/execute?workerId=${wid}&app=premiere&operation=trim_clip`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({clipId:'c1', in:'00:00:01:00', out:'00:00:03:00'}) }).then(r=>r.json());
assert.equal(valid.ok, true);

const high = await fetch(`http://127.0.0.1:3789/worker/execute?workerId=${wid}&app=premiere&operation=delete_clip`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({clipId:'x'}) }).then(r=>r.json());
assert.equal(high.needsApproval, true);

const approvals = await fetch('http://127.0.0.1:3789/worker/approvals').then(r=>r.json());
assert.ok(approvals.length > 0);
const aid = approvals[0].approvalId;

const forbidden = await fetch(`http://127.0.0.1:3789/worker/approve?approvalId=${aid}&actorId=not_allowed`, { method:'POST' }).then(r=>r.json());
assert.equal(forbidden.error, 'forbidden');

const approved = await fetch(`http://127.0.0.1:3789/worker/approve?approvalId=${aid}&actorId=5238367056`, { method:'POST' }).then(r=>r.json());
assert.equal(typeof approved.ok, 'boolean');

const teamUsers = await fetch('http://127.0.0.1:3789/team/users').then(r=>r.json());
assert.ok(teamUsers.some(u => u.userId === '5238367056'));

const metrics = await fetch('http://127.0.0.1:3789/metrics').then(r=>r.text());
assert.ok(metrics.includes('creativeclaw_events_total'));

worker.kill('SIGTERM');
gateway.kill('SIGTERM');

console.log('INTEGRATION_GATEWAY_WORKER_OK');
