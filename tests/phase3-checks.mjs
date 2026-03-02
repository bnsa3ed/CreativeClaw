import assert from 'node:assert/strict';
import { StyleLearningEngine } from '../dist/packages/memory/src/style-learning.js';
import { InMemoryVectorBackend } from '../dist/packages/memory/src/vector-backends.js';

const now = Date.now();
const engine = new StyleLearningEngine(() => now);
const summary = engine.summarize('p1', [
  { editType: 'trim', projectId: 'p1', confidence: 0.9, approved: true, timestamp: now - 1000, signals: {} },
  { editType: 'trim', projectId: 'p1', confidence: 0.6, approved: false, timestamp: now - 86400000 * 20, signals: {} }
]);
assert.equal(summary.projectId, 'p1');
assert.equal(summary.count, 2);
assert.ok(summary.weightedConfidence > 0.7);
assert.ok(summary.approvalRatio > 0.4);

const v = new InMemoryVectorBackend();
await v.upsert({ id: '1', projectId: 'p1', text: 'a', embedding: [1, 0] });
await v.upsert({ id: '2', projectId: 'p1', text: 'b', embedding: [0, 1] });
const q = await v.query('p1', [0.9, 0.1], 1);
assert.equal(q.length, 1);
assert.equal(q[0].id, '1');

console.log('PHASE3_CHECKS_OK');
