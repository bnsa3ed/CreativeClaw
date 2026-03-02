export interface SearchItem { title: string; url: string; description?: string }

export class BraveSearchClient {
  constructor(private apiKey?: string) {}

  async search(query: string, count = 5): Promise<SearchItem[]> {
    if (!this.apiKey) {
      return [{ title: `Mock result for: ${query}`, url: 'https://example.com', description: 'Set BRAVE_SEARCH_API_KEY for live results' }];
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));

    const res = await fetch(url, { headers: { 'X-Subscription-Token': this.apiKey, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);

    const json = (await res.json()) as any;
    const results = (json.web?.results || []) as any[];
    return results.map(r => ({ title: r.title, url: r.url, description: r.description }));
  }
}
