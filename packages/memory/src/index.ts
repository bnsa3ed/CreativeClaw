export interface StyleSignal {
  editType: string;
  projectId: string;
  confidence: number;
  timestamp: number;
  signals: Record<string, unknown>;
}

export class MemoryStore {
  private signals: StyleSignal[] = [];

  remember(signal: StyleSignal): void {
    this.signals.push(signal);
  }

  recall(projectId: string): StyleSignal[] {
    return this.signals.filter(s => s.projectId === projectId);
  }

  aggregate(projectId: string) {
    const rows = this.recall(projectId);
    const avgConfidence = rows.length ? rows.reduce((a, b) => a + b.confidence, 0) / rows.length : 0;
    return { projectId, count: rows.length, avgConfidence };
  }
}
