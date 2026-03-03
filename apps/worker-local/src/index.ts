/**
 * CreativeClaw Local Worker
 * Bridges the gateway ↔ Adobe apps via WebSocket.
 * Features:
 *  - Auto-reconnect with exponential backoff (never gives up)
 *  - Graceful shutdown on SIGTERM/SIGINT
 *  - PID file at ~/.creativeclaw/worker.pid for CLI management
 *  - Loads .env automatically
 */

import WebSocket from 'ws';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../../../packages/core/src/index.js';
import type {
  LocalBridgeMessage,
  WorkerHello,
  WorkerExecute,
  WorkerResult,
} from '../../../packages/protocol/src/index.js';
import { runConnectorOperation } from '../../../packages/connectors-adobe/src/index.js';

// Load .env before reading any env vars
loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────

const GATEWAY_WS_URL =
  process.env.CREATIVECLAW_GATEWAY_WS || 'ws://127.0.0.1:3789/ws/local';
const WORKER_ID =
  process.env.CREATIVECLAW_WORKER_ID || `worker_${Math.floor(Math.random() * 9999)}`;

// Reconnect delays: 1s → 2s → 5s → 10s → 30s (then stays at 30s)
const BACKOFF = [1000, 2000, 5000, 10000, 30000];

// ─── PID file ─────────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), '.creativeclaw');
const PID_FILE = join(DATA_DIR, 'worker.pid');

function writePid() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch {}
}

function removePid() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
}

writePid();

// ─── State ────────────────────────────────────────────────────────────────────

let attempt = 0;
let currentWs: WebSocket | null = null;
let shuttingDown = false;

// ─── Connection factory ────────────────────────────────────────────────────────

function connect() {
  if (shuttingDown) return;

  const ws = new WebSocket(GATEWAY_WS_URL);
  currentWs = ws;

  ws.on('open', () => {
    attempt = 0; // reset backoff on success
    console.log(`[CreativeClaw Worker] Connected to gateway as ${WORKER_ID}`);
    console.log(`[CreativeClaw Worker] Gateway: ${GATEWAY_WS_URL}`);

    const hello: WorkerHello = {
      type: 'worker_hello',
      workerId: WORKER_ID,
      capabilities: ['premiere', 'aftereffects', 'photoshop', 'illustrator'],
    };
    ws.send(JSON.stringify(hello));
  });

  ws.on('message', async (raw: WebSocket.RawData) => {
    let msg: LocalBridgeMessage;
    try {
      msg = JSON.parse(String(raw)) as LocalBridgeMessage;
    } catch {
      console.error('[CreativeClaw Worker] Bad message from gateway');
      return;
    }

    if (msg.type !== 'execute') return;

    const req = msg as WorkerExecute;
    console.log(`[CreativeClaw Worker] Executing ${req.app}/${req.operation}`);

    let result: Awaited<ReturnType<typeof runConnectorOperation>>;
    try {
      result = await runConnectorOperation(req.app, req.operation, req.payload);
    } catch (err: any) {
      result = {
        ok: false,
        app: req.app,
        operation: req.operation,
        error: err?.message || 'unknown_error',
        executionMode: 'mock',
      };
    }

    const res: WorkerResult = {
      type: 'result',
      requestId: req.requestId,
      ok: result.ok,
      output: result.ok ? result.output : undefined,
      error: result.ok ? undefined : result.error,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(res));
    }
  });

  ws.on('close', (code, reason) => {
    currentWs = null;
    if (shuttingDown) return;

    const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
    attempt++;
    console.log(
      `[CreativeClaw Worker] Disconnected (${code}). Reconnecting in ${delay / 1000}s... (attempt ${attempt})`
    );
    setTimeout(connect, delay);
  });

  ws.on('error', (err: Error) => {
    // 'close' fires right after 'error' — reconnect is handled there
    if (!shuttingDown) {
      console.error(`[CreativeClaw Worker] WebSocket error: ${err.message}`);
    }
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[CreativeClaw Worker] Received ${signal} — shutting down cleanly`);
  removePid();
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.close(1000, 'Worker shutting down');
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// ─── Start ────────────────────────────────────────────────────────────────────

console.log('[CreativeClaw Worker] Starting...');
console.log(`[CreativeClaw Worker] Worker ID: ${WORKER_ID}`);
console.log(`[CreativeClaw Worker] PID: ${process.pid} → ${PID_FILE}`);
console.log(`[CreativeClaw Worker] Adobe mock mode: ${process.env.CREATIVECLAW_ADOBE_MOCK === 'true' ? 'ON' : 'OFF'}`);

connect();
