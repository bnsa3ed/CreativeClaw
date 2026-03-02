import { dataDir, decryptText, encryptText, readJsonFile, writeJsonFile } from '../../core/src/index.js';
import { join } from 'node:path';

export interface APITemplateMethod {
  endpoint: string;
  method: 'GET' | 'POST';
  cache?: boolean;
}

export interface APITemplate {
  name: string;
  baseUrl: string;
  authType: 'api_key' | 'bearer';
  methods: Record<string, APITemplateMethod>;
}

export interface APIConnection {
  name: string;
  baseUrl: string;
  authType: 'api_key' | 'bearer';
  secret: string;
  apiKeyHeader?: string;
}

export const defaultTemplates: Record<string, APITemplate> = {
  elevenlabs: {
    name: 'ElevenLabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    authType: 'api_key',
    methods: { text_to_speech: { endpoint: '/text-to-speech/{voice_id}', method: 'POST' }, get_voices: { endpoint: '/voices', method: 'GET', cache: true } }
  },
  freepik: {
    name: 'Freepik',
    baseUrl: 'https://api.freepik.com/v1',
    authType: 'bearer',
    methods: { search: { endpoint: '/resources/search', method: 'GET', cache: true } }
  },
  pexels: {
    name: 'Pexels',
    baseUrl: 'https://api.pexels.com/v1',
    authType: 'api_key',
    methods: { search_videos: { endpoint: '/videos/search', method: 'GET', cache: true }, search_photos: { endpoint: '/search', method: 'GET', cache: true } }
  }
};

export class APIRegistry {
  private templates = new Map(Object.entries(defaultTemplates));
  private storePath = join(dataDir(), 'api-connections.json');

  listTemplates() { return [...this.templates.keys()]; }
  getTemplate(name: string) { return this.templates.get(name); }

  private loadConnections(secret: string): Record<string, APIConnection> {
    const raw = readJsonFile<Record<string, APIConnection & { secret: string }>>(this.storePath, {});
    const out: Record<string, APIConnection> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        out[k] = { ...v, secret: decryptText(v.secret, secret) };
      } catch {
        // ignore undecryptable entries
      }
    }
    return out;
  }

  private saveConnections(conns: Record<string, APIConnection>, secret: string): void {
    const encrypted: Record<string, APIConnection> = {};
    for (const [k, v] of Object.entries(conns)) {
      encrypted[k] = { ...v, secret: encryptText(v.secret, secret) };
    }
    writeJsonFile(this.storePath, encrypted);
  }

  listConnections(secret: string): string[] {
    return Object.keys(this.loadConnections(secret));
  }

  addConnection(conn: APIConnection, secret: string): void {
    const all = this.loadConnections(secret);
    all[conn.name] = conn;
    this.saveConnections(all, secret);
  }

  removeConnection(name: string, secret: string): void {
    const all = this.loadConnections(secret);
    delete all[name];
    this.saveConnections(all, secret);
  }

  getConnection(name: string, secret: string): APIConnection | undefined {
    return this.loadConnections(secret)[name];
  }

  async testConnection(name: string, secret: string): Promise<{ ok: boolean; detail: string }> {
    const conn = this.getConnection(name, secret);
    if (!conn) return { ok: false, detail: 'not_found' };

    const headers: Record<string, string> = {};
    if (conn.authType === 'bearer') headers.Authorization = `Bearer ${conn.secret}`;
    if (conn.authType === 'api_key') headers[conn.apiKeyHeader || 'x-api-key'] = conn.secret;

    try {
      const r = await fetch(conn.baseUrl, { method: 'GET', headers });
      return { ok: r.ok, detail: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
