/**
 * @creativeclaw/scheduler
 * SQLite-backed job scheduler with cron expressions and one-shot timers.
 * Runs inside the gateway process — call start() to begin ticking.
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export type ScheduleKind = 'cron' | 'interval' | 'once';

export interface ScheduledJob {
  id: string;
  label: string;
  kind: ScheduleKind;
  /** cron: "0 2 * * *" | interval: ms between runs | once: unix ms timestamp */
  schedule: string;
  /** Operation to execute */
  app: string;
  operation: string;
  payload: string; // JSON string
  workerId?: string;
  webhookUrl?: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt: number;
  createdAt: number;
  runCount: number;
}

export type ScheduledJobInput = Omit<ScheduledJob, 'id' | 'createdAt' | 'runCount' | 'nextRunAt' | 'lastRunAt'>;

export type DispatchFn = (
  app: string, operation: string,
  payload: Record<string, unknown>,
  workerId?: string,
) => Promise<unknown>;

// ─── Simple cron parser ───────────────────────────────────────────────────────

function parseCron(expr: string): (d: Date) => boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return () => false;
  const [min, hour, dom, month, dow] = parts;

  function match(val: number, field: string): boolean {
    if (field === '*') return true;
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return val % parseInt(step) === 0;
    }
    if (field.includes(',')) return field.split(',').map(Number).includes(val);
    if (field.includes('-')) {
      const [a, b] = field.split('-').map(Number);
      return val >= a && val <= b;
    }
    return parseInt(field) === val;
  }

  return (d: Date) =>
    match(d.getMinutes(), min) &&
    match(d.getHours(), hour) &&
    match(d.getDate(), dom) &&
    match(d.getMonth() + 1, month) &&
    match(d.getDay(), dow);
}

function nextCronMs(expr: string, from = Date.now()): number {
  const check = parseCron(expr);
  let d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // start from next minute
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (check(d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return from + 86_400_000; // fallback: 1 day
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class Scheduler {
  private db: DatabaseSync;
  private timer?: NodeJS.Timeout;
  private dispatch?: DispatchFn;
  readonly TICK_MS = 30_000; // check every 30 seconds

  constructor() {
    const dir = join(homedir(), '.creativeclaw');
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'scheduler.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        schedule TEXT NOT NULL,
        app TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        workerId TEXT,
        webhookUrl TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        lastRunAt INTEGER,
        nextRunAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        runCount INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /** Wire up the dispatch function from the gateway */
  setDispatch(fn: DispatchFn): void {
    this.dispatch = fn;
  }

  /** Start the ticker */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), this.TICK_MS);
    this._tick(); // immediate first check
    console.log(`[Scheduler] Started — checking every ${this.TICK_MS / 1000}s`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  add(input: ScheduledJobInput): ScheduledJob {
    const id = `sched_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const now = Date.now();
    const nextRunAt = this._calcNext(input.kind, input.schedule, now);
    const job: ScheduledJob = { id, ...input, nextRunAt, createdAt: now, runCount: 0 };
    this.db.prepare(`
      INSERT INTO scheduled_jobs
        (id,label,kind,schedule,app,operation,payload,workerId,webhookUrl,enabled,nextRunAt,createdAt,runCount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.label, input.kind, input.schedule, input.app, input.operation,
      typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload),
      input.workerId ?? null, input.webhookUrl ?? null,
      input.enabled ? 1 : 0, nextRunAt, now, 0,
    );
    return job;
  }

  list(): ScheduledJob[] {
    return (this.db.prepare(`SELECT * FROM scheduled_jobs ORDER BY nextRunAt ASC`).all() as any[])
      .map(this._row);
  }

  get(id: string): ScheduledJob | undefined {
    const r = this.db.prepare(`SELECT * FROM scheduled_jobs WHERE id=?`).get(id) as any;
    return r ? this._row(r) : undefined;
  }

  update(id: string, patch: Partial<Pick<ScheduledJob, 'label' | 'enabled' | 'schedule' | 'payload' | 'webhookUrl' | 'workerId'>>): ScheduledJob | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...patch };
    const nextRunAt = this._calcNext(updated.kind, updated.schedule, Date.now());
    this.db.prepare(`
      UPDATE scheduled_jobs SET label=?,enabled=?,schedule=?,payload=?,webhookUrl=?,workerId=?,nextRunAt=? WHERE id=?
    `).run(
      updated.label, updated.enabled ? 1 : 0, updated.schedule,
      typeof updated.payload === 'string' ? updated.payload : JSON.stringify(updated.payload),
      updated.webhookUrl ?? null, updated.workerId ?? null, nextRunAt, id,
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.prepare(`DELETE FROM scheduled_jobs WHERE id=?`).run(id).changes > 0;
  }

  // ─── Tick ─────────────────────────────────────────────────────────────────

  private async _tick(): Promise<void> {
    const due = (this.db.prepare(
      `SELECT * FROM scheduled_jobs WHERE enabled=1 AND nextRunAt<=? ORDER BY nextRunAt ASC`,
    ).all(Date.now()) as any[]).map(this._row);

    for (const job of due) {
      await this._run(job).catch(err =>
        console.error(`[Scheduler] Job ${job.id} (${job.label}) failed:`, err instanceof Error ? err.message : err),
      );
    }
  }

  private async _run(job: ScheduledJob): Promise<void> {
    const now = Date.now();
    console.log(`[Scheduler] Running job "${job.label}" (${job.app}/${job.operation})`);

    let result: unknown = null;
    let error: string | undefined;

    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      if (this.dispatch) {
        result = await this.dispatch(job.app, job.operation, payload, job.workerId);
      } else {
        console.warn(`[Scheduler] No dispatch function set — job ${job.id} skipped`);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Job error:`, error);
    }

    // Update run metadata
    const nextRunAt = job.kind === 'once' ? 0 : this._calcNext(job.kind, job.schedule, now);
    this.db.prepare(`
      UPDATE scheduled_jobs SET lastRunAt=?, nextRunAt=?, runCount=runCount+1,
      enabled=CASE WHEN kind='once' THEN 0 ELSE enabled END WHERE id=?
    `).run(now, nextRunAt, job.id);

    // Webhook callback
    if (job.webhookUrl) {
      await this._webhook(job.webhookUrl, { jobId: job.id, label: job.label, app: job.app, operation: job.operation, result, error, timestamp: now })
        .catch(e => console.error(`[Scheduler] Webhook failed for ${job.id}:`, e instanceof Error ? e.message : e));
    }
  }

  private async _webhook(url: string, body: unknown): Promise<void> {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-creativeclaw-event': 'job.completed' },
      body: JSON.stringify(body),
    });
  }

  private _calcNext(kind: ScheduleKind, schedule: string, from: number): number {
    if (kind === 'once') return parseInt(schedule) || from;
    if (kind === 'interval') return from + (parseInt(schedule) || 60_000);
    if (kind === 'cron') return nextCronMs(schedule, from);
    return from + 60_000;
  }

  private _row(r: any): ScheduledJob {
    return { ...r, enabled: r.enabled === 1 };
  }
}
