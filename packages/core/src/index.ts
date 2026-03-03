import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load .env file into process.env.
 * Walks up from the current file location to find the project root .env.
 * Only sets variables that are NOT already in the environment
 * (real env vars always win over .env values).
 * Safe to call multiple times — idempotent.
 */
export function loadEnv(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export type DetailLevel = 'name_only' | 'name_description' | 'full_schema';

export interface CreativeClawConfig {
  gateway: { port: number; host: string };
  models: { primary: string; fallback?: string };
  security: { requireApprovalForHighRisk: boolean };
}

export const defaultConfig: CreativeClawConfig = {
  gateway: { port: 3789, host: '127.0.0.1' },
  models: { primary: 'openai-codex/gpt-5.3-codex' },
  security: { requireApprovalForHighRisk: true }
};

export function mergeConfig(partial: Partial<CreativeClawConfig>): CreativeClawConfig {
  return {
    gateway: { ...defaultConfig.gateway, ...(partial.gateway || {}) },
    models: { ...defaultConfig.models, ...(partial.models || {}) },
    security: { ...defaultConfig.security, ...(partial.security || {}) }
  };
}

export function dataDir(): string {
  const dir = join(homedir(), '.creativeclaw');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function keyFromSecret(secret: string): Buffer {
  return scryptSync(secret, 'creativeclaw_salt', 32);
}

export function encryptText(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const key = keyFromSecret(secret);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptText(encoded: string, secret: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = keyFromSecret(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
