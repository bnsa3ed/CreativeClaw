export type AdobeApp = 'premiere' | 'aftereffects' | 'photoshop' | 'illustrator';

export * from './operations.js';
export * from './handlers.js';
export * from './extendscript-gen.js';
export { isAppRunning, isOsascriptAvailable } from './macos-bridge.js';

export interface ConnectorHealth {
  app: AdobeApp;
  healthy: boolean;
  running: boolean;
  message: string;
  executionMode: 'real' | 'mock';
}

export class AdobeConnectorHub {
  async health(): Promise<ConnectorHealth[]> {
    const { isAppRunning, isOsascriptAvailable } = await import('./macos-bridge.js');
    const mockMode = process.env.CREATIVECLAW_ADOBE_MOCK === 'true';
    const hasMac = await isOsascriptAvailable();

    const apps: AdobeApp[] = ['premiere', 'aftereffects', 'photoshop', 'illustrator'];
    return Promise.all(
      apps.map(async (app) => {
        const running = hasMac && !mockMode ? await isAppRunning(app) : false;
        const executionMode: 'real' | 'mock' = (hasMac && !mockMode) ? 'real' : 'mock';
        return {
          app,
          healthy: true,
          running,
          executionMode,
          message: mockMode
            ? 'Mock mode (CREATIVECLAW_ADOBE_MOCK=true)'
            : running
            ? `${app} is open and ready`
            : `${app} not detected — will fail gracefully if targeted`,
        };
      }),
    );
  }
}
