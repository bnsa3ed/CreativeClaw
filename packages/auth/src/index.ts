/**
 * @creativeclaw/auth
 * API key management + request authentication middleware.
 *
 * Keys are passed as:
 *   Authorization: Bearer <key>
 *   X-API-Key: <key>
 *
 * Public routes (no auth required): /health, /telegram/inbound
 */

import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { IncomingMessage } from 'node:http';

export interface ApiKey {
  id: string;
  label: string;
  keyHash: string;
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
}

export interface ApiKeyPublic {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
}

// Routes that bypass auth entirely
const PUBLIC_ROUTES = new Set(['/health', '/telegram/inbound', '/metrics']);

export class AuthManager {
  private db: DatabaseSync;

  constructor() {
    const dir = join(homedir(), '.creativeclaw');
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'auth.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        keyHash TEXT NOT NULL UNIQUE,
        createdAt INTEGER NOT NULL,
        lastUsedAt INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `);
    this._ensureDefaultKey();
  }

  /** Generate a new API key, store its hash, return the plaintext once */
  create(label: string): { key: string; record: ApiKeyPublic } {
    const raw = `cc_${randomBytes(24).toString('hex')}`;
    const keyHash = this._hash(raw);
    const id = `key_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO api_keys (id, label, keyHash, createdAt, enabled) VALUES (?,?,?,?,1)`,
    ).run(id, label, keyHash, createdAt);
    return { key: raw, record: { id, label, createdAt, enabled: true } };
  }

  list(): ApiKeyPublic[] {
    return (this.db.prepare(`SELECT id,label,createdAt,lastUsedAt,enabled FROM api_keys ORDER BY createdAt DESC`).all() as any[])
      .map(r => ({ ...r, enabled: r.enabled === 1 }));
  }

  revoke(id: string): boolean {
    const r = this.db.prepare(`UPDATE api_keys SET enabled=0 WHERE id=?`).run(id);
    return r.changes > 0;
  }

  delete(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM api_keys WHERE id=?`).run(id);
    return r.changes > 0;
  }

  /** Verify a plaintext key, update lastUsedAt, return true if valid */
  verify(raw: string): boolean {
    const hash = this._hash(raw);
    const row = this.db.prepare(`SELECT id, enabled FROM api_keys WHERE keyHash=?`).get(hash) as any;
    if (!row || !row.enabled) return false;
    this.db.prepare(`UPDATE api_keys SET lastUsedAt=? WHERE id=?`).run(Date.now(), row.id);
    return true;
  }

  /** Verify Telegram webhook signature (HMAC-SHA256 of body with bot token) */
  verifyTelegramSignature(body: string, signature: string, botToken: string): boolean {
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    return `sha256=${expected}` === signature || expected === signature;
  }

  /** Check if a request is authenticated. Returns null if ok, or error string */
  authenticate(req: IncomingMessage, rawBody?: string): string | null {
    const pathname = new URL(req.url || '/', `http://localhost`).pathname;

    // Public routes always pass
    if (PUBLIC_ROUTES.has(pathname)) return null;

    // CREATIVECLAW_API_KEY env var as master bypass (useful in dev / Docker)
    const masterKey = process.env.CREATIVECLAW_API_KEY;

    const authHeader = req.headers['authorization'] || '';
    const keyHeader = (req.headers['x-api-key'] as string) || '';

    let candidate = '';
    if (authHeader.startsWith('Bearer ')) candidate = authHeader.slice(7).trim();
    else if (keyHeader) candidate = keyHeader.trim();

    if (!candidate) return 'missing_api_key';
    if (masterKey && candidate === masterKey) return null;
    if (this.verify(candidate)) return null;
    return 'invalid_api_key';
  }

  private _hash(raw: string): string {
    return createHmac('sha256', 'creativeclaw-key-hash-salt').update(raw).digest('hex');
  }

  /** On first run with no keys, auto-generate one and print it */
  private _ensureDefaultKey(): void {
    const count = (this.db.prepare(`SELECT COUNT(*) as n FROM api_keys WHERE enabled=1`).get() as any).n;
    if (count === 0 && !process.env.CREATIVECLAW_API_KEY) {
      const { key } = this.create('default');
      console.log(`\n[CreativeClaw Auth] ⚠️  No API keys found. Generated default key:`);
      console.log(`  CREATIVECLAW_API_KEY=${key}`);
      console.log(`  Add to your .env or pass as Authorization: Bearer <key>\n`);
    }
  }
}
