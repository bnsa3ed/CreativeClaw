export interface ActionRunInput {
  code: string;
  timeoutMs?: number;
}

export interface ActionRunOutput {
  ok: boolean;
  logs: string[];
  error?: string;
}

export class ActionExecutor {
  async run(input: ActionRunInput): Promise<ActionRunOutput> {
    const timeoutMs = input.timeoutMs ?? 3000;
    try {
      const fn = new Function('console', 'setTimeout', input.code);
      const logs: string[] = [];
      const fakeConsole = { log: (...args: unknown[]) => logs.push(args.map(String).join(' ')) };
      const timer = setTimeout(() => {
        throw new Error('Action timed out');
      }, timeoutMs);
      fn(fakeConsole, setTimeout);
      clearTimeout(timer);
      return { ok: true, logs };
    } catch (err) {
      return { ok: false, logs: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
