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
  private jobs: Job[] = [];

  add(name: string, risk: JobRisk, maxAttempts = 3): Job {
    const job: Job = { id: `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`, name, risk, attempts: 0, maxAttempts, status: risk === 'high' ? 'needs_approval' : 'queued' };
    this.jobs.push(job);
    return job;
  }

  approve(id: string): Job | undefined {
    const job = this.jobs.find(j => j.id === id);
    if (job && job.status === 'needs_approval') job.status = 'queued';
    return job;
  }

  async runNext(worker: (job: Job) => Promise<void>): Promise<Job | undefined> {
    const job = this.jobs.find(j => j.status === 'queued');
    if (!job) return undefined;
    job.status = 'running';
    job.attempts += 1;
    try {
      await worker(job);
      job.status = 'done';
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      if (job.attempts < job.maxAttempts) job.status = 'queued';
      else job.status = 'failed';
    }
    return job;
  }

  list() { return this.jobs; }
}
