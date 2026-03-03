/**
 * @creativeclaw/action-executor
 * Sandboxed action runtime.
 *
 * Two modes:
 *  1. executeScript(code) — run arbitrary JS in a sandboxed context (local, no Adobe)
 *  2. executeOperation(app, operation, payload) — dispatch via gateway HTTP API
 */

export interface ActionRunInput {
  code: string;
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

export interface ActionRunOutput {
  ok: boolean;
  logs: string[];
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface OperationInput {
  app: string;
  operation: string;
  payload?: Record<string, unknown>;
  workerId?: string;
  webhookUrl?: string;
}

export interface OperationOutput {
  ok: boolean;
  output?: unknown;
  error?: string;
  executionMode?: 'real' | 'mock';
  durationMs: number;
}

// ─── Script sandbox ───────────────────────────────────────────────────────────

export class ActionExecutor {
  private gatewayUrl: string;
  private apiKey: string;

  constructor(gatewayUrl?: string, apiKey?: string) {
    this.gatewayUrl = gatewayUrl || process.env.CREATIVECLAW_GATEWAY || 'http://127.0.0.1:3789';
    this.apiKey = apiKey || process.env.CREATIVECLAW_API_KEY || '';
  }

  /** Execute a JS snippet in a sandboxed context. Safe for simple expressions. */
  async executeScript(input: ActionRunInput): Promise<ActionRunOutput> {
    const timeoutMs = input.timeoutMs ?? 5000;
    const start = Date.now();
    const logs: string[] = [];

    try {
      const fakeConsole = {
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        warn: (...a: unknown[]) => logs.push('[warn] ' + a.map(String).join(' ')),
        error: (...a: unknown[]) => logs.push('[error] ' + a.map(String).join(' ')),
      };

      // Inject safe context helpers
      const context = {
        console: fakeConsole,
        JSON,
        Math,
        Date,
        parseInt,
        parseFloat,
        String,
        Number,
        Boolean,
        Array,
        Object,
        ...(input.context || {}),
      };

      const result = await Promise.race([
        new Promise<unknown>((resolve, reject) => {
          try {
            const fn = new Function(...Object.keys(context), `"use strict";\n${input.code}`);
            resolve(fn(...Object.values(context)));
          } catch (e) {
            reject(e);
          }
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

      return { ok: true, logs, result, durationMs: Date.now() - start };
    } catch (err) {
      return { ok: false, logs, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start };
    }
  }

  /** Dispatch an Adobe operation to the gateway → worker pipeline */
  async executeOperation(input: OperationInput): Promise<OperationOutput> {
    const start = Date.now();
    const { app, operation, payload = {}, workerId, webhookUrl } = input;

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

      // Get first available worker if not specified
      let wid = workerId;
      if (!wid) {
        const workersRes = await fetch(`${this.gatewayUrl}/workers`, { headers });
        const workers: any[] = await workersRes.json();
        wid = workers?.[0]?.workerId;
      }

      if (!wid) {
        return { ok: false, error: 'no_worker_connected', durationMs: Date.now() - start };
      }

      const params = new URLSearchParams({ workerId: wid, app, operation });
      if (webhookUrl) params.set('webhookUrl', webhookUrl);

      const res = await fetch(`${this.gatewayUrl}/worker/execute?${params}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data: any = await res.json();
      return {
        ok: data?.ok ?? false,
        output: data?.output,
        error: data?.error,
        executionMode: data?.executionMode,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start };
    }
  }

  /** Run natural language via the AI endpoint */
  async executeNL(text: string, workerId?: string, webhookUrl?: string): Promise<{ ok: boolean; reply: string; result?: unknown; durationMs: number }> {
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
      const res = await fetch(`${this.gatewayUrl}/ai/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, workerId, webhookUrl }),
      });
      const data: any = await res.json();
      return { ok: data?.ok ?? false, reply: data?.reply || '', result: data?.result, durationMs: Date.now() - start };
    } catch (err) {
      return { ok: false, reply: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start };
    }
  }
}
