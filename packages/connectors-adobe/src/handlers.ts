import type { AdobeApp } from './index.js';

export interface ConnectorExecutionResult {
  ok: boolean;
  app: AdobeApp;
  operation: string;
  output?: unknown;
  error?: string;
}

export async function runConnectorOperation(app: AdobeApp, operation: string, payload?: Record<string, unknown>): Promise<ConnectorExecutionResult> {
  // Stubbed operation handlers to be replaced with real UXP bridge calls
  if (app === 'premiere' && operation === 'trim_clip') {
    return { ok: true, app, operation, output: { action: 'trim_clip', applied: true, payload } };
  }
  if (app === 'premiere' && operation === 'insert_clip') {
    return { ok: true, app, operation, output: { action: 'insert_clip', applied: true, payload } };
  }
  if (app === 'aftereffects' && operation === 'add_keyframe') {
    return { ok: true, app, operation, output: { action: 'add_keyframe', applied: true, payload } };
  }
  if (app === 'photoshop' && operation === 'apply_lut') {
    return { ok: true, app, operation, output: { action: 'apply_lut', applied: true, payload } };
  }
  if (app === 'illustrator' && operation === 'replace_text') {
    return { ok: true, app, operation, output: { action: 'replace_text', applied: true, payload } };
  }

  return { ok: false, app, operation, error: 'unsupported_operation' };
}
