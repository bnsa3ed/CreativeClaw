export type AdobeApp = 'premiere' | 'aftereffects' | 'photoshop' | 'illustrator';

export interface ConnectorHealth {
  app: AdobeApp;
  healthy: boolean;
  message: string;
}

export class AdobeConnectorHub {
  health(): ConnectorHealth[] {
    return [
      { app: 'premiere', healthy: true, message: 'Connector stub ready' },
      { app: 'aftereffects', healthy: true, message: 'Connector stub ready' },
      { app: 'photoshop', healthy: true, message: 'Connector stub ready' },
      { app: 'illustrator', healthy: true, message: 'Connector stub ready' }
    ];
  }
}
