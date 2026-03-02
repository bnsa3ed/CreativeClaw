export interface APITemplateMethod {
  endpoint: string;
  method: 'GET' | 'POST';
  cache?: boolean;
}

export interface APITemplate {
  name: string;
  baseUrl: string;
  authType: 'api_key' | 'bearer';
  methods: Record<string, APITemplateMethod>;
}

export const defaultTemplates: Record<string, APITemplate> = {
  elevenlabs: {
    name: 'ElevenLabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    authType: 'api_key',
    methods: { text_to_speech: { endpoint: '/text-to-speech/{voice_id}', method: 'POST' }, get_voices: { endpoint: '/voices', method: 'GET', cache: true } }
  },
  freepik: {
    name: 'Freepik',
    baseUrl: 'https://api.freepik.com/v1',
    authType: 'bearer',
    methods: { search: { endpoint: '/resources/search', method: 'GET', cache: true } }
  },
  pexels: {
    name: 'Pexels',
    baseUrl: 'https://api.pexels.com/v1',
    authType: 'api_key',
    methods: { search_videos: { endpoint: '/videos/search', method: 'GET', cache: true }, search_photos: { endpoint: '/search', method: 'GET', cache: true } }
  }
};

export class APIRegistry {
  private templates = new Map(Object.entries(defaultTemplates));

  list() { return [...this.templates.keys()]; }
  get(name: string) { return this.templates.get(name); }
  register(name: string, template: APITemplate) { this.templates.set(name, template); }
}
