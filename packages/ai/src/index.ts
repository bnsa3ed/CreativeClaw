/**
 * @creativeclaw/ai
 * Natural language → Adobe operation mapping via Claude (Anthropic).
 *
 * Set ANTHROPIC_API_KEY to enable real NLP.
 * Without it, returns a helpful "not understood" response.
 */

import Anthropic from '@anthropic-ai/sdk';
import { operationSchemas, type OperationSchema } from '../../connectors-adobe/src/index.js';

export interface ParsedOperation {
  app: string;
  operation: string;
  payload: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  raw?: string;
}

export interface NLPResult {
  ok: boolean;
  parsed?: ParsedOperation;
  reply: string;         // Human-readable response to send back to user
  error?: string;
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const ops = operationSchemas.map(s =>
    `- ${s.app}/${s.operation} (risk: ${s.risk}) — required fields: ${s.requiredFields.join(', ')}`
  ).join('\n');

  return `You are CreativeClaw, an AI assistant that controls Adobe creative applications.
Your job is to parse the user's natural language request and map it to a structured operation.

Available operations:
${ops}

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "app": "<premiere|aftereffects|photoshop|illustrator>",
  "operation": "<operation_name>",
  "payload": { <required fields with values extracted from user message> },
  "confidence": "<high|medium|low>",
  "reply": "<a short friendly message to send back to the user confirming what you're doing, or explaining what info is missing>"
}

If the request cannot be mapped to any operation, respond with:
{
  "app": null,
  "operation": null,
  "payload": {},
  "confidence": "low",
  "reply": "<explain what you understood and what's missing or unsupported>"
}

Rules:
- Extract values precisely from the user's message (timecodes, paths, layer names, etc.)
- If a required field cannot be determined from the message, set confidence to "low" and ask for it in the reply
- Never invent clip IDs or file paths — use what the user says
- For high-risk operations (delete, export), note it in the reply
- Be concise and friendly`;
}

// ─── NLP Router ───────────────────────────────────────────────────────────────

export class NLPRouter {
  private client: Anthropic | null = null;
  private model: string;

  constructor(model = 'claude-3-5-haiku-20241022') {
    this.model = model;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      console.warn('[CreativeClaw AI] ANTHROPIC_API_KEY not set — NLP disabled, using rule-based fallback');
    }
  }

  get enabled(): boolean {
    return !!this.client;
  }

  /**
   * Parse a natural language string into a structured operation.
   * Falls back to rule-based matching if Anthropic is unavailable.
   */
  async parse(text: string, context?: { projectId?: string; workerId?: string }): Promise<NLPResult> {
    // Try rule-based first for simple slash-style commands
    const ruled = this._ruleBased(text);
    if (ruled) return ruled;

    if (!this.client) {
      return {
        ok: false,
        reply: `I couldn't understand that request. NLP is disabled (no ANTHROPIC_API_KEY). ` +
          `Available operations: ${operationSchemas.map(s => `${s.app}/${s.operation}`).join(', ')}`,
        error: 'nlp_disabled',
      };
    }

    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: text }],
      });

      const raw = (message.content[0] as any).text as string;
      let parsed: any;

      try {
        // Strip possible markdown code fences
        const clean = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        return {
          ok: false,
          reply: "I had trouble understanding that. Could you rephrase? (e.g. 'trim clip intro from 5s to 30s in Premiere')",
          error: 'parse_error',
        };
      }

      if (!parsed.app || !parsed.operation) {
        return { ok: false, reply: parsed.reply || "I couldn't map that to an operation.", error: 'no_operation' };
      }

      // Validate against schema
      const schema = operationSchemas.find(s => s.app === parsed.app && s.operation === parsed.operation);
      if (!schema) {
        return {
          ok: false,
          reply: `${parsed.app}/${parsed.operation} is not a supported operation.\n${parsed.reply || ''}`,
          error: 'unsupported_operation',
        };
      }

      const missing = schema.requiredFields.filter(f => !(f in (parsed.payload || {})));
      if (missing.length > 0) {
        return {
          ok: false,
          reply: parsed.reply || `Missing required fields: ${missing.join(', ')}`,
          parsed: { ...parsed, confidence: 'low' },
          error: 'missing_fields',
        };
      }

      return {
        ok: true,
        parsed: {
          app: parsed.app,
          operation: parsed.operation,
          payload: parsed.payload || {},
          confidence: parsed.confidence || 'medium',
          raw: text,
        },
        reply: parsed.reply || `Got it — running ${parsed.operation} on ${parsed.app}.`,
      };
    } catch (err) {
      return {
        ok: false,
        reply: 'AI service unavailable. Try again shortly.',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Simple rule-based parser for common patterns.
   * Handles things like "trim clip X from 0:05 to 1:30".
   */
  private _ruleBased(text: string): NLPResult | null {
    const t = text.toLowerCase();

    // trim clip
    const trimMatch = text.match(/trim\s+(?:clip\s+)?["']?([^"'\s]+)["']?\s+(?:from\s+)?(\d+[:\d.]*)\s+(?:to\s+)?(\d+[:\d.]*)/i);
    if (trimMatch) {
      return {
        ok: true,
        parsed: { app: 'premiere', operation: 'trim_clip', payload: { clipId: trimMatch[1], in: trimMatch[2], out: trimMatch[3] }, confidence: 'high' },
        reply: `Trimming clip "${trimMatch[1]}" from ${trimMatch[2]} to ${trimMatch[3]} in Premiere.`,
      };
    }

    // delete clip
    const deleteMatch = text.match(/delete\s+(?:clip\s+)?["']?([^"'\s]+)["']?/i);
    if (deleteMatch && (t.includes('premiere') || t.includes('clip'))) {
      return {
        ok: true,
        parsed: { app: 'premiere', operation: 'delete_clip', payload: { clipId: deleteMatch[1] }, confidence: 'high' },
        reply: `⚠️ Deleting clip "${deleteMatch[1]}" from Premiere (HIGH RISK — will require approval).`,
      };
    }

    // apply lut
    const lutMatch = text.match(/apply\s+(?:lut\s+)?["']?([^"'\s]+)["']?\s+(?:to\s+)?(?:layer\s+)?["']?([^"'\s]+)["']?/i);
    if (lutMatch && t.includes('lut')) {
      return {
        ok: true,
        parsed: { app: 'photoshop', operation: 'apply_lut', payload: { lutName: lutMatch[1], layer: lutMatch[2] }, confidence: 'high' },
        reply: `Applying LUT "${lutMatch[1]}" to layer "${lutMatch[2]}" in Photoshop.`,
      };
    }

    // replace text
    const replaceMatch = text.match(/replace\s+(?:text\s+)?["']?([^"']+)["']?\s+(?:with\s+)["']?([^"']+)["']?/i);
    if (replaceMatch) {
      return {
        ok: true,
        parsed: { app: 'illustrator', operation: 'replace_text', payload: { textObject: replaceMatch[1].trim(), value: replaceMatch[2].trim() }, confidence: 'high' },
        reply: `Replacing text "${replaceMatch[1].trim()}" with "${replaceMatch[2].trim()}" in Illustrator.`,
      };
    }

    // resize
    const resizeMatch = text.match(/resize\s+(?:to\s+)?(\d+)\s*[x×]\s*(\d+)/i);
    if (resizeMatch) {
      return {
        ok: true,
        parsed: { app: 'photoshop', operation: 'resize', payload: { width: parseInt(resizeMatch[1]), height: parseInt(resizeMatch[2]) }, confidence: 'high' },
        reply: `Resizing document to ${resizeMatch[1]}×${resizeMatch[2]}px in Photoshop.`,
      };
    }

    // export
    const exportMatch = text.match(/export\s+(?:to\s+)?["']?([^\s"']+)["']?/i);
    if (exportMatch) {
      const outPath = exportMatch[1];
      const ext = outPath.split('.').pop()?.toLowerCase() || '';
      const app = ['psd', 'jpg', 'jpeg', 'png', 'tiff'].includes(ext) ? 'photoshop'
        : ['ai', 'svg', 'pdf'].includes(ext) ? 'illustrator'
        : ['mp4', 'mov', 'avi'].includes(ext) ? 'premiere' : null;
      if (app) {
        const operation = app === 'premiere' ? 'export_sequence' : 'export';
        return {
          ok: true,
          parsed: { app, operation, payload: { outputPath: outPath }, confidence: 'medium' },
          reply: `Exporting to "${outPath}" via ${app}.`,
        };
      }
    }

    return null;
  }
}

// ─── Conversation memory for Telegram ─────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class ConversationMemory {
  private history = new Map<number, ConversationTurn[]>();
  private readonly maxTurns = 10;

  add(chatId: number, role: 'user' | 'assistant', content: string): void {
    if (!this.history.has(chatId)) this.history.set(chatId, []);
    const turns = this.history.get(chatId)!;
    turns.push({ role, content, timestamp: Date.now() });
    if (turns.length > this.maxTurns * 2) turns.splice(0, 2);
  }

  get(chatId: number): ConversationTurn[] {
    return this.history.get(chatId) || [];
  }

  clear(chatId: number): void {
    this.history.delete(chatId);
  }
}
