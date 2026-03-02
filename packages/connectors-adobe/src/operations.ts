import type { AdobeApp } from './index.js';

export type OperationRisk = 'low' | 'medium' | 'high';

export interface OperationSchema {
  app: AdobeApp;
  operation: string;
  requiredFields: string[];
  risk: OperationRisk;
}

export const operationSchemas: OperationSchema[] = [
  { app: 'premiere', operation: 'trim_clip', requiredFields: ['clipId', 'in', 'out'], risk: 'medium' },
  { app: 'premiere', operation: 'insert_clip', requiredFields: ['assetPath', 'track', 'timecode'], risk: 'low' },
  { app: 'aftereffects', operation: 'add_keyframe', requiredFields: ['layer', 'property', 'time', 'value'], risk: 'medium' },
  { app: 'photoshop', operation: 'apply_lut', requiredFields: ['layer', 'lutName'], risk: 'low' },
  { app: 'illustrator', operation: 'replace_text', requiredFields: ['textObject', 'value'], risk: 'low' },
  { app: 'premiere', operation: 'delete_clip', requiredFields: ['clipId'], risk: 'high' },
  { app: 'aftereffects', operation: 'delete_layer', requiredFields: ['layer'], risk: 'high' }
];

export function getOperationSchema(app: AdobeApp, operation: string): OperationSchema | undefined {
  return operationSchemas.find(s => s.app === app && s.operation === operation);
}

export function validateOperationPayload(schema: OperationSchema, payload: Record<string, unknown> | undefined): { ok: boolean; missing: string[] } {
  const p = payload || {};
  const missing = schema.requiredFields.filter(k => !(k in p));
  return { ok: missing.length === 0, missing };
}
