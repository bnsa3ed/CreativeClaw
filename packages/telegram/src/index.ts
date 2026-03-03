/**
 * @creativeclaw/telegram
 * Telegram Bot API client with webhook + long-polling support,
 * signature verification, and a simple command/NLP router.
 */

import { createHmac } from 'node:crypto';

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    data?: string;
    message?: TelegramMessage;
  };
}

export type CommandHandler = (msg: TelegramMessage, args: string[]) => Promise<void>;
export type FallbackHandler = (msg: TelegramMessage, text: string) => Promise<void>;

export class TelegramBot {
  private readonly token: string;
  private readonly baseUrl: string;
  private commandHandlers = new Map<string, CommandHandler>();
  private fallbackHandler?: FallbackHandler;
  private pollOffset = 0;
  private polling = false;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  // ─── API primitives ───────────────────────────────────────────────────────

  async call<T = any>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: any = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
    return data.result as T;
  }

  async getMe() {
    return this.call('getMe');
  }

  async sendMessage(chatId: number | string, text: string, extra?: Record<string, unknown>) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  }

  async sendMarkdown(chatId: number | string, text: string) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'MarkdownV2' });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async setWebhook(url: string, secretToken?: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      allowed_updates: ['message', 'callback_query'],
      ...(secretToken ? { secret_token: secretToken } : {}),
    });
    console.log(`[Telegram] Webhook registered: ${url}`);
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook');
    console.log('[Telegram] Webhook deleted');
  }

  async getWebhookInfo() {
    return this.call('getWebhookInfo');
  }

  /** Verify Telegram webhook X-Telegram-Bot-Api-Secret-Token header */
  verifySecret(secretToken: string, header: string): boolean {
    return header === secretToken;
  }

  /** Verify X-Telegram-Signature (HMAC-SHA256 of body) */
  verifySignature(body: string, signatureHeader: string): boolean {
    const secret = createHmac('sha256', 'WebAppData').update(this.token).digest();
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    return signatureHeader === expected || signatureHeader === `sha256=${expected}`;
  }

  // ─── Long polling ─────────────────────────────────────────────────────────

  async startPolling(): Promise<void> {
    // Remove webhook first so polling works
    await this.call('deleteWebhook').catch(() => {});
    this.polling = true;
    console.log('[Telegram] Starting long-poll loop...');
    this._poll();
  }

  stopPolling(): void {
    this.polling = false;
  }

  private async _poll(): Promise<void> {
    while (this.polling) {
      try {
        const updates: TelegramUpdate[] = await this.call('getUpdates', {
          offset: this.pollOffset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const u of updates) {
          this.pollOffset = u.update_id + 1;
          await this._dispatch(u).catch(err => console.error('[Telegram] dispatch error:', err));
        }
      } catch (err) {
        if (this.polling) {
          console.error('[Telegram] Poll error (retrying in 5s):', err instanceof Error ? err.message : err);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }
  }

  // ─── Routing ──────────────────────────────────────────────────────────────

  /** Register a /command handler */
  command(name: string, handler: CommandHandler): this {
    this.commandHandlers.set(name.replace(/^\//, ''), handler);
    return this;
  }

  /** Register a fallback for non-command messages (NLP entry point) */
  onMessage(handler: FallbackHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  /** Process an incoming update (call this from webhook handler too) */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    await this._dispatch(update);
  }

  private async _dispatch(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text) return;

    const text = msg.text.trim();

    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = (parts[0] || '').toLowerCase().replace(/@\w+$/, ''); // strip @botname
      const args = parts.slice(1);
      const handler = this.commandHandlers.get(cmd);
      if (handler) {
        await handler(msg, args);
      } else {
        await this.sendMessage(msg.chat.id, `Unknown command: /${cmd}\nUse /help for available commands.`);
      }
    } else if (this.fallbackHandler) {
      await this.fallbackHandler(msg, text);
    }
  }
}
