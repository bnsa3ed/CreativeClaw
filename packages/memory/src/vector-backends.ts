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
}

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
}

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
