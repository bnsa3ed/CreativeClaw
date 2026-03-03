import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export interface VectorRecord {
  id: string;
  projectId: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult extends VectorRecord {
  score: number;
}

export interface VectorBackend {
  upsert(record: VectorRecord): Promise<void>;
  query(projectId: string, embedding: number[], limit?: number): Promise<VectorSearchResult[]>;
  listProjects?(): Promise<string[]>;
}

// ─── In-Memory Backend ────────────────────────────────────────────────────────

export class InMemoryVectorBackend implements VectorBackend {
  private rows: VectorRecord[] = [];

  async upsert(record: VectorRecord): Promise<void> {
    const idx = this.rows.findIndex(r => r.id === record.id);
    if (idx >= 0) this.rows[idx] = record;
    else this.rows.push(record);
  }

  async query(projectId: string, embedding: number[], limit = 5): Promise<VectorSearchResult[]> {
    const scoped = this.rows.filter(r => r.projectId === projectId);
    return scoped
      .map(r => ({ ...r, score: cosineSimilarity(r.embedding, embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async listProjects(): Promise<string[]> {
    return [...new Set(this.rows.map(r => r.projectId))];
  }
}

// ─── SQLite Persistent Backend ────────────────────────────────────────────────

export class SQLiteVectorBackend implements VectorBackend {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const dir = join(homedir(), '.creativeclaw');
    mkdirSync(dir, { recursive: true });
    const path = dbPath ?? join(dir, 'vectors.sqlite');
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_project ON vectors(projectId);
    `);
  }

  async upsert(record: VectorRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO vectors (id, projectId, text, embedding, metadata, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         projectId=excluded.projectId, text=excluded.text,
         embedding=excluded.embedding, metadata=excluded.metadata,
         updatedAt=excluded.updatedAt`,
    ).run(
      record.id,
      record.projectId,
      record.text,
      JSON.stringify(record.embedding),
      record.metadata ? JSON.stringify(record.metadata) : null,
      Date.now(),
    );
  }

  async query(projectId: string, embedding: number[], limit = 5): Promise<VectorSearchResult[]> {
    const rows = this.db.prepare(
      `SELECT id, projectId, text, embedding, metadata FROM vectors WHERE projectId=?`,
    ).all(projectId) as any[];

    return rows
      .map(r => {
        const emb: number[] = JSON.parse(r.embedding);
        return {
          id: r.id,
          projectId: r.projectId,
          text: r.text,
          embedding: emb,
          metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
          score: cosineSimilarity(emb, embedding),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async listProjects(): Promise<string[]> {
    const rows = this.db.prepare(`SELECT DISTINCT projectId FROM vectors ORDER BY projectId`).all() as any[];
    return rows.map(r => r.projectId);
  }

  count(projectId?: string): number {
    if (projectId) {
      return (this.db.prepare(`SELECT COUNT(*) as n FROM vectors WHERE projectId=?`).get(projectId) as any).n;
    }
    return (this.db.prepare(`SELECT COUNT(*) as n FROM vectors`).get() as any).n;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
