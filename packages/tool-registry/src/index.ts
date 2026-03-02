import type { DetailLevel } from '../../core/src/index.js';

export interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  searchTools(query: string, detailLevel: DetailLevel = 'name_description') {
    const q = query.toLowerCase();
    const hits = this.list().filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    return hits.map(t => {
      if (detailLevel === 'name_only') return { name: t.name };
      if (detailLevel === 'name_description') return { name: t.name, description: t.description, risk: t.risk };
      return t;
    });
  }
}
