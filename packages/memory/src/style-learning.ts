export interface StyleSignal {
  editType: string;
  projectId: string;
  confidence: number;
  approved: boolean;
  timestamp: number;
  signals: Record<string, unknown>;
}

export interface StyleLearningSummary {
  projectId: string;
  count: number;
  weightedConfidence: number;
  approvalRatio: number;
  recencyScore: number;
}

export class StyleLearningEngine {
  constructor(private nowFn: () => number = () => Date.now()) {}

  summarize(projectId: string, rows: StyleSignal[]): StyleLearningSummary {
    const scoped = rows.filter(r => r.projectId === projectId);
    if (!scoped.length) {
      return { projectId, count: 0, weightedConfidence: 0, approvalRatio: 0, recencyScore: 0 };
    }

    const now = this.nowFn();
    const dayMs = 86400000;

    let weighted = 0;
    let sumW = 0;
    let approved = 0;
    let recencyAccum = 0;

    for (const r of scoped) {
      const ageDays = Math.max(0, (now - r.timestamp) / dayMs);
      const recency = 1 / (1 + ageDays / 7);
      const approvalBoost = r.approved ? 1.15 : 0.85;
      const w = Math.max(0.05, recency * approvalBoost);
      weighted += r.confidence * w;
      sumW += w;
      if (r.approved) approved += 1;
      recencyAccum += recency;
    }

    return {
      projectId,
      count: scoped.length,
      weightedConfidence: Number((weighted / sumW).toFixed(4)),
      approvalRatio: Number((approved / scoped.length).toFixed(4)),
      recencyScore: Number((recencyAccum / scoped.length).toFixed(4))
    };
  }
}
