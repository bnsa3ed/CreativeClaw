export interface ObsEvent {
  name: string;
  at: number;
  level: 'info' | 'warn' | 'error';
  attrs?: Record<string, unknown>;
}

export class EventBus {
  private events: ObsEvent[] = [];

  emit(name: string, level: ObsEvent['level'] = 'info', attrs?: Record<string, unknown>) {
    this.events.push({ name, at: Date.now(), level, attrs });
  }

  list(limit = 100): ObsEvent[] {
    return this.events.slice(-limit);
  }

  counters() {
    const out: Record<string, number> = {};
    for (const e of this.events) out[e.name] = (out[e.name] || 0) + 1;
    return out;
  }
}
