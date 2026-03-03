import type { AdobeApp } from './index.js';

export type OperationRisk = 'low' | 'medium' | 'high';

export interface OperationSchema {
  app: AdobeApp;
  operation: string;
  requiredFields: string[];
  risk: OperationRisk;
}

export const operationSchemas: OperationSchema[] = [
  // Premiere Pro
  { app: 'premiere', operation: 'trim_clip', requiredFields: ['clipId', 'in', 'out'], risk: 'medium' },
  { app: 'premiere', operation: 'insert_clip', requiredFields: ['assetPath', 'track', 'timecode'], risk: 'low' },
  { app: 'premiere', operation: 'delete_clip', requiredFields: ['clipId'], risk: 'high' },
  { app: 'premiere', operation: 'export_sequence', requiredFields: ['outputPath'], risk: 'low' },
  // After Effects
  { app: 'aftereffects', operation: 'add_keyframe', requiredFields: ['layer', 'property', 'time', 'value'], risk: 'medium' },
  { app: 'aftereffects', operation: 'delete_layer', requiredFields: ['layer'], risk: 'high' },
  { app: 'aftereffects', operation: 'render_comp', requiredFields: ['outputPath'], risk: 'medium' },
  // Photoshop
  { app: 'photoshop', operation: 'apply_lut', requiredFields: ['layer', 'lutName'], risk: 'low' },
  { app: 'photoshop', operation: 'apply_curves', requiredFields: ['channel', 'points'], risk: 'low' },
  { app: 'photoshop', operation: 'resize', requiredFields: ['width', 'height'], risk: 'medium' },
  { app: 'photoshop', operation: 'export', requiredFields: ['outputPath'], risk: 'low' },
  // Illustrator
  { app: 'illustrator', operation: 'replace_text', requiredFields: ['textObject', 'value'], risk: 'low' },
  { app: 'illustrator', operation: 'export', requiredFields: ['outputPath'], risk: 'low' },
];

export function getOperationSchema(app: AdobeApp, operation: string): OperationSchema | undefined {
  return operationSchemas.find(s => s.app === app && s.operation === operation);
}

export function validateOperationPayload(schema: OperationSchema, payload: Record<string, unknown> | undefined): { ok: boolean; missing: string[] } {
  const p = payload || {};
  const missing = schema.requiredFields.filter(k => !(k in p));
  return { ok: missing.length === 0, missing };
}
