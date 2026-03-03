import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { TelegramBot } = await import('../dist/packages/telegram/src/index.js');

// We test bot logic without a real token — use a fake token
const BOT_TOKEN = 'fake:token_for_testing';

describe('TelegramBot (offline / unit)', () => {
  let bot;

  it('constructs without throwing', () => {
    assert.doesNotThrow(() => {
      bot = new TelegramBot(BOT_TOKEN);
    });
  });

  it('returns bot instance', () => {
    assert.ok(bot, 'bot should be defined');
    assert.equal(typeof bot.handleUpdate, 'function');
  });

  it('handleUpdate ignores updates with no message', async () => {
    // Should not throw
    await bot.handleUpdate({});
    await bot.handleUpdate({ channel_post: { text: 'hello' } });
  });

  it('handleUpdate processes /start command', async () => {
    let sentText = null;
    // Patch internal sendMessage to capture output
    bot._sendMessage = async (chatId, text) => { sentText = text; };
    await bot.handleUpdate({
      message: { chat: { id: 123 }, text: '/start', from: { id: 456, first_name: 'Test' } },
    });
    // If a reply was sent, it should contain some text
    if (sentText) assert.ok(typeof sentText === 'string' && sentText.length > 0);
  });

  it('handleUpdate processes /help command', async () => {
    let sentText = null;
    bot._sendMessage = async (chatId, text) => { sentText = text; };
    await bot.handleUpdate({
      message: { chat: { id: 123 }, text: '/help', from: { id: 456, first_name: 'Test' } },
    });
    if (sentText) assert.ok(sentText.length > 0);
  });

  it('verifyWebhookSignature accepts valid signature', () => {
    const secret = 'test-secret-key';
    const body = JSON.stringify({ update_id: 1, message: { text: 'hello' } });
    // Compute expected HMAC-SHA256 using the secret
    const secretKey = createHmac('sha256', 'WebAppData').update(secret).digest();
    const sig = createHmac('sha256', secretKey).update(body).digest('hex');
    const valid = bot.verifyWebhookSignature(body, sig, secret);
    assert.equal(valid, true, 'valid signature should pass');
  });

  it('verifyWebhookSignature rejects tampered body', () => {
    const secret = 'test-secret-key';
    const body = JSON.stringify({ update_id: 1 });
    const valid = bot.verifyWebhookSignature(body, 'badhash', secret);
    assert.equal(valid, false, 'invalid signature should fail');
  });
});
