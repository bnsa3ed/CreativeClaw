import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { dataDir } from '../../core/src/index.js';

export type Role = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface TeamUser {
  userId: string;
  role: Role;
}

export class TeamRBAC {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(join(dataDir(), 'team.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_users (
        userId TEXT PRIMARY KEY,
        role TEXT NOT NULL
      );
    `);
    // seed owner from env on first use if table empty
    const c = this.db.prepare('SELECT COUNT(*) as c FROM team_users').get() as any;
    if ((c?.c || 0) === 0) {
      const owner = process.env.CREATIVECLAW_OWNER_ID || '5238367056';
      this.upsert(owner, 'owner');
    }
  }

  upsert(userId: string, role: Role): TeamUser {
    this.db.prepare(`INSERT INTO team_users (userId, role) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET role=excluded.role`).run(userId, role);
    return { userId, role };
  }

  remove(userId: string): void {
    this.db.prepare('DELETE FROM team_users WHERE userId=?').run(userId);
  }

  list(): TeamUser[] {
    const rows = this.db.prepare('SELECT userId, role FROM team_users ORDER BY userId ASC').all() as Array<Record<string, unknown>>;
    return rows.map(r => ({ userId: String(r.userId), role: String(r.role) as Role }));
  }

  roleOf(userId: string): Role | null {
    const r = this.db.prepare('SELECT role FROM team_users WHERE userId=?').get(userId) as any;
    return (r?.role || null) as Role | null;
  }

  canApprove(userId: string): boolean {
    const role = this.roleOf(userId);
    return role === 'owner' || role === 'reviewer';
  }
}
