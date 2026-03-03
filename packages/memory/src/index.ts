export * from './style-learning.js';
export * from './vector-backends.js';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { StyleLearningEngine, type StyleSignal } from './style-learning.js';
import { SQLiteVectorBackend } from './vector-backends.js';

export interface ProjectProfile {
  projectId: string;
  signalCount: number;
  lastActivity: number;
  topEditTypes: string[];
  avgConfidence: number;
}

export class MemoryStore {
  private db: DatabaseSync;
  private engine = new StyleLearningEngine();
  readonly vectors: SQLiteVectorBackend;

  constructor() {
    const dir = join(homedir(), '.creativeclaw');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'memory.sqlite');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS style_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        projectId TEXT NOT NULL,
        editType TEXT NOT NULL,
        confidence REAL NOT NULL,
        approved INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        signals TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_signals_project ON style_signals(projectId);
      CREATE INDEX IF NOT EXISTS idx_signals_ts ON style_signals(timestamp);
    `);
    this.vectors = new SQLiteVectorBackend();
  }

  remember(signal: StyleSignal): void {
    this.db.prepare(
      `INSERT INTO style_signals (projectId, editType, confidence, approved, timestamp, signals)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      signal.projectId,
      signal.editType,
      signal.confidence,
      signal.approved ? 1 : 0,
      signal.timestamp,
      signal.signals ? JSON.stringify(signal.signals) : null,
    );
  }

  recall(projectId: string, limit = 500): StyleSignal[] {
    const rows = this.db.prepare(
      `SELECT * FROM style_signals WHERE projectId=? ORDER BY timestamp DESC LIMIT ?`,
    ).all(projectId, limit) as any[];
    return rows.map(r => ({
      projectId: r.projectId,
      editType: r.editType,
      confidence: r.confidence,
      approved: r.approved === 1,
      timestamp: r.timestamp,
      signals: r.signals ? JSON.parse(r.signals) : {},
    }));
  }

  aggregate(projectId: string) {
    const signals = this.recall(projectId);
    return this.engine.summarize(projectId, signals);
  }

  /** All project IDs that have signals */
  listProjects(): ProjectProfile[] {
    const rows = this.db.prepare(`
      SELECT
        projectId,
        COUNT(*) as signalCount,
        MAX(timestamp) as lastActivity,
        AVG(confidence) as avgConfidence
      FROM style_signals
      GROUP BY projectId
      ORDER BY lastActivity DESC
    `).all() as any[];

    return rows.map(r => {
      const editTypeRows = this.db.prepare(`
        SELECT editType, COUNT(*) as n FROM style_signals
        WHERE projectId=? GROUP BY editType ORDER BY n DESC LIMIT 5
      `).all(r.projectId) as any[];

      return {
        projectId: r.projectId,
        signalCount: r.signalCount,
        lastActivity: r.lastActivity,
        avgConfidence: Math.round(r.avgConfidence * 100) / 100,
        topEditTypes: editTypeRows.map((e: any) => e.editType),
      };
    });
  }

  stats() {
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM style_signals`).get() as any).n;
    const projects = (this.db.prepare(`SELECT COUNT(DISTINCT projectId) as n FROM style_signals`).get() as any).n;
    const vectorCount = this.vectors.count();
    return { totalSignals: total, projects, vectorRecords: vectorCount };
  }
}
