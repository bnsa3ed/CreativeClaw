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
        createdAt INTEGER NOT NULL
      );
    `);
  }

  add(name: string, risk: JobRisk, maxAttempts = 3): Job {
    const job: Job = {
      id: `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      risk,
      attempts: 0,
      maxAttempts,
      status: risk === 'high' ? 'needs_approval' : 'queued'
    };
    this.db.prepare(`INSERT INTO jobs (id,name,risk,attempts,maxAttempts,status,lastError,createdAt) VALUES (?,?,?,?,?,?,?,?)`)
      .run(job.id, job.name, job.risk, job.attempts, job.maxAttempts, job.status, null, Date.now());
    return job;
  }

  approve(id: string): Job | undefined {
    this.db.prepare(`UPDATE jobs SET status='queued' WHERE id=? AND status='needs_approval'`).run(id);
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
    this.db.prepare(`UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=?`).run(job.id);
    job.attempts += 1;

    try {
      await worker(job);
      this.db.prepare(`UPDATE jobs SET status='done', lastError=NULL WHERE id=?`).run(job.id);
      job.status = 'done';
      job.lastError = undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed = job.attempts >= job.maxAttempts;
      this.db.prepare(`UPDATE jobs SET status=?, lastError=? WHERE id=?`).run(failed ? 'failed' : 'queued', msg, job.id);
      job.status = failed ? 'failed' : 'queued';
      job.lastError = msg;
    }
    return job;
  }

  list(): Job[] {
    return (this.db.prepare(`SELECT id,name,risk,attempts,maxAttempts,status,lastError FROM jobs ORDER BY createdAt DESC`).all() as any[]) as Job[];
  }
}
