export * from './style-learning.js';
export * from './vector-backends.js';

import { StyleLearningEngine, type StyleSignal } from './style-learning.js';

export class MemoryStore {
  private signals: StyleSignal[] = [];
  private engine = new StyleLearningEngine();

  remember(signal: StyleSignal): void {
    this.signals.push(signal);
  }

  recall(projectId: string): StyleSignal[] {
    return this.signals.filter(s => s.projectId === projectId);
  }

  aggregate(projectId: string) {
    return this.engine.summarize(projectId, this.signals);
  }
}
