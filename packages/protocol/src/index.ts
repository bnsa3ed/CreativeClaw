export type AdobeApp = 'premiere' | 'aftereffects' | 'photoshop' | 'illustrator';

export interface WorkerHello {
  type: 'worker_hello';
  workerId: string;
  capabilities: AdobeApp[];
}

export interface WorkerExecute {
  type: 'execute';
  requestId: string;
  app: AdobeApp;
  operation: string;
  payload?: Record<string, unknown>;
}

export interface WorkerResult {
  type: 'result';
  requestId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export type LocalBridgeMessage = WorkerHello | WorkerExecute | WorkerResult;
