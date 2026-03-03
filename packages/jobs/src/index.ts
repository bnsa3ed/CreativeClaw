import { dataDir } from '../../core/src/index.js';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type JobRisk = 'low' | 'medium' | 'high';
export type JobStatus = 'queued' | 'needs_approval' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  name: string;
  risk: JobRisk;
  attempts: number;
  maxAttempts: number;
  status: JobStatus;
  lastError?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface OperationLog {
  id: string;
  app: string;
  operation: string;
  workerId: string;
  ok: boolean;
  payload?: string;
  output?: string;
  error?: string;
  executionMode: 'real' | 'mock';
  durationMs: number;
  timestamp: number;
}

export interface HistoryOptions {
  limit?: number;
  offset?: number;
  status?: JobStatus;
}

export class JobQueue {
  private db: DatabaseSync;

  constructor() {
    const dbPath = join(dataDir(), 'jobs.sqlite');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        risk TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        maxAttempts INTEGER NOT NULL,
        status TEXT NOT NULL,
        lastError TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS operation_log (
        id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        operation TEXT NOT NULL,
        workerId TEXT NOT NULL,
        ok INTEGER NOT NULL,
        payload TEXT,
        output TEXT,
        error TEXT,
        executionMode TEXT NOT NULL DEFAULT 'mock',
        durationMs INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `);
  }

  add(name: string, risk: JobRisk, maxAttempts = 3): Job {
    const now = Date.now();
    const job: Job = {
      id: `job_${now}_${Math.floor(Math.random() * 1000)}`,
      name,
      risk,
      attempts: 0,
      maxAttempts,
      status: risk === 'high' ? 'needs_approval' : 'queued',
      createdAt: now,
    };
    this.db.prepare(
      `INSERT INTO jobs (id,name,risk,attempts,maxAttempts,status,lastError,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(job.id, job.name, job.risk, job.attempts, job.maxAttempts, job.status, null, now, now);
    return job;
  }

  approve(id: string): Job | undefined {
    const now = Date.now();
    this.db.prepare(`UPDATE jobs SET status='queued', updatedAt=? WHERE id=? AND status='needs_approval'`).run(now, id);
    return this.get(id);
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as any;
    if (!row) return undefined;
    return { ...row } as Job;
  }

  async runNext(worker: (job: Job) => Promise<void>): Promise<Job | undefined> {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY createdAt ASC LIMIT 1`).get() as any;
    if (!row) return undefined;

    const job: Job = { ...row };
    const now = Date.now();
    this.db.prepare(`UPDATE jobs SET status='running', attempts=attempts+1, updatedAt=? WHERE id=?`).run(now, job.id);
    job.attempts += 1;

    try {
      await worker(job);
      const done = Date.now();
      this.db.prepare(`UPDATE jobs SET status='done', lastError=NULL, updatedAt=? WHERE id=?`).run(done, job.id);
      job.status = 'done';
      job.lastError = undefined;
      job.updatedAt = done;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed = job.attempts >= job.maxAttempts;
      const done = Date.now();
      this.db.prepare(`UPDATE jobs SET status=?, lastError=?, updatedAt=? WHERE id=?`).run(
        failed ? 'failed' : 'queued', msg, done, job.id,
      );
      job.status = failed ? 'failed' : 'queued';
      job.lastError = msg;
      job.updatedAt = done;
    }
    return job;
  }

  list(): Job[] {
    return (this.db.prepare(
      `SELECT * FROM jobs ORDER BY createdAt DESC`,
    ).all() as any[]) as Job[];
  }

  /** Paginated job history with optional status filter */
  history(opts: HistoryOptions = {}): { jobs: Job[]; total: number } {
    const { limit = 50, offset = 0, status } = opts;
    const where = status ? `WHERE status=?` : '';
    const params = status ? [status, limit, offset] : [limit, offset];
    const countParams = status ? [status] : [];
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM jobs ${where}`).get(...countParams) as any).n as number;
    const jobs = (this.db.prepare(
      `SELECT * FROM jobs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    ).all(...params) as any[]) as Job[];
    return { jobs, total };
  }

  /** Log an executed Adobe operation */
  logOperation(entry: Omit<OperationLog, 'id'>): OperationLog {
    const id = `op_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    this.db.prepare(
      `INSERT INTO operation_log (id,app,operation,workerId,ok,payload,output,error,executionMode,durationMs,timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      entry.app,
      entry.operation,
      entry.workerId,
      entry.ok ? 1 : 0,
      entry.payload ?? null,
      entry.output ?? null,
      entry.error ?? null,
      entry.executionMode,
      entry.durationMs,
      entry.timestamp,
    );
    return { id, ...entry };
  }

  /** Paginated operation history */
  operationHistory(limit = 100, offset = 0): { ops: OperationLog[]; total: number } {
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM operation_log`).get() as any).n as number;
    const ops = (this.db.prepare(
      `SELECT * FROM operation_log ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset) as any[]).map((r: any) => ({ ...r, ok: r.ok === 1 })) as OperationLog[];
    return { ops, total };
  }

  stats(): { byStatus: Record<string, number>; byRisk: Record<string, number>; total: number } {
    const byStatus: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    const rows = this.db.prepare(`SELECT status, risk, COUNT(*) as n FROM jobs GROUP BY status, risk`).all() as any[];
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + r.n;
      byRisk[r.risk] = (byRisk[r.risk] || 0) + r.n;
      total += r.n;
    }
    return { byStatus, byRisk, total };
  }
}
