import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'cc-sched-test-'));
process.env.CREATIVECLAW_DATA_DIR = tmpDir;

const { Scheduler } = await import('../dist/packages/scheduler/src/index.js');

describe('Scheduler', () => {
  let sched;
  let jobId;
  let dispatched = [];

  before(() => {
    sched = new Scheduler();
    sched.setDispatch(async (app, operation, payload) => {
      dispatched.push({ app, operation, payload });
      return { ok: true };
    });
    // Do NOT call sched.start() in tests — avoids timer noise
  });

  after(() => {
    sched.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a one-shot job', () => {
    const futureMs = Date.now() + 60_000; // 1 min from now
    const job = sched.add({
      label: 'test-once',
      kind: 'once',
      schedule: String(futureMs),
      app: 'photoshop',
      operation: 'resize',
      payload: { width: 1920, height: 1080 },
      enabled: true,
    });
    assert.ok(job.id, 'should have an id');
    assert.equal(job.label, 'test-once');
    assert.equal(job.kind, 'once');
    jobId = job.id;
  });

  it('adds a cron job', () => {
    const job = sched.add({
      label: 'nightly',
      kind: 'cron',
      schedule: '0 2 * * *',
      app: 'premiere',
      operation: 'export_sequence',
      payload: {},
      enabled: true,
    });
    assert.ok(job.id);
    assert.equal(job.kind, 'cron');
  });

  it('adds an interval job', () => {
    const job = sched.add({
      label: 'poll',
      kind: 'interval',
      schedule: '3600000',
      app: 'aftereffects',
      operation: 'render_comp',
      payload: {},
      enabled: true,
    });
    assert.ok(job.id);
    assert.equal(job.kind, 'interval');
  });

  it('lists all jobs', () => {
    const jobs = sched.list();
    assert.ok(Array.isArray(jobs));
    assert.ok(jobs.length >= 3, `expected at least 3 jobs, got ${jobs.length}`);
  });

  it('updates a job', () => {
    const updated = sched.update(jobId, { label: 'test-once-updated', enabled: false });
    assert.equal(updated?.label, 'test-once-updated');
    assert.equal(updated?.enabled, false);
  });

  it('reflects the update in list', () => {
    const jobs = sched.list();
    const found = jobs.find(j => j.id === jobId);
    assert.ok(found, 'updated job should still exist');
    assert.equal(found.enabled, false);
  });

  it('removes a job', () => {
    sched.remove(jobId);
    const jobs = sched.list();
    assert.ok(!jobs.find(j => j.id === jobId), 'removed job should not appear');
  });
});
