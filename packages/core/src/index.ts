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
