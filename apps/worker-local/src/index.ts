import WebSocket from 'ws';
import type { LocalBridgeMessage, WorkerHello, WorkerExecute, WorkerResult } from '../../../packages/protocol/src/index.js';
import { runConnectorOperation } from '../../../packages/connectors-adobe/src/index.js';

const GATEWAY_WS_URL = process.env.CREATIVECLAW_GATEWAY_WS || 'ws://127.0.0.1:3789/ws/local';
const WORKER_ID = process.env.CREATIVECLAW_WORKER_ID || `worker_${Math.floor(Math.random() * 9999)}`;

const ws = new WebSocket(GATEWAY_WS_URL);

ws.on('open', () => {
  const hello: WorkerHello = {
    type: 'worker_hello',
    workerId: WORKER_ID,
    capabilities: ['premiere', 'aftereffects', 'photoshop', 'illustrator']
  };
  ws.send(JSON.stringify(hello));
  console.log(`CreativeClaw local worker connected: ${WORKER_ID}`);
});

ws.on('message', async (raw: WebSocket.RawData) => {
  const msg = JSON.parse(String(raw)) as LocalBridgeMessage;
  if (msg.type !== 'execute') return;

  const req = msg as WorkerExecute;
  const result = await runConnectorOperation(req.app, req.operation, req.payload);

  const res: WorkerResult = {
    type: 'result',
    requestId: req.requestId,
    ok: result.ok,
    output: result.ok ? result.output : undefined,
    error: result.ok ? undefined : result.error
  };
  ws.send(JSON.stringify(res));
});

ws.on('close', () => {
  console.log('Worker disconnected from gateway');
});

ws.on('error', (err: Error) => {
  console.error('Worker websocket error', err);
});
