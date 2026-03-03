import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Run without an Anthropic key — rule-based fallback only
delete process.env.ANTHROPIC_API_KEY;

const { NLPRouter, ConversationMemory } = await import('../dist/packages/ai/src/index.js');

describe('NLPRouter (rule-based fallback)', () => {
  const router = new NLPRouter();

  it('parses a trim command', async () => {
    const result = await router.parse('trim clip intro from 5s to 30s');
    assert.ok(result, 'should return a result');
    assert.equal(result.operation, 'trim_clip');
    assert.ok(result.confidence > 0);
  });

  it('parses a resize command', async () => {
    const result = await router.parse('resize to 1920x1080');
    assert.equal(result.operation, 'resize');
    assert.ok(result.confidence > 0);
  });

  it('parses a replace text command', async () => {
    const result = await router.parse('replace text "Draft" with "Final"');
    assert.equal(result.operation, 'replace_text');
  });

  it('parses an apply LUT command', async () => {
    const result = await router.parse('apply lut Kodak2383 to background layer');
    assert.equal(result.operation, 'apply_lut');
  });

  it('parses an export command', async () => {
    const result = await router.parse('export to /tmp/output.mp4');
    assert.equal(result.operation, 'export_sequence');
  });

  it('parses a delete command', async () => {
    const result = await router.parse('delete clip B-roll');
    assert.equal(result.operation, 'delete_clip');
  });

  it('parses add keyframe command', async () => {
    const result = await router.parse('add keyframe to position at 2s');
    assert.equal(result.operation, 'add_keyframe');
  });

  it('returns unknown for unrecognised input', async () => {
    const result = await router.parse('hello how are you doing today');
    assert.ok(result, 'should not throw');
    // Confidence should be low or operation unknown
    assert.ok(result.confidence < 0.5 || result.operation === 'unknown');
  });
});

describe('ConversationMemory', () => {
  const mem = new ConversationMemory();

  it('stores and retrieves messages', () => {
    mem.add('chat1', 'user', 'trim clip');
    mem.add('chat1', 'assistant', 'Trimming clip...');
    const history = mem.get('chat1');
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
  });

  it('keeps separate histories per chat', () => {
    mem.add('chat2', 'user', 'hello');
    assert.equal(mem.get('chat1').length, 2);
    assert.equal(mem.get('chat2').length, 1);
  });

  it('clears a chat history', () => {
    mem.clear('chat1');
    assert.equal(mem.get('chat1').length, 0);
  });

  it('handles an unseen chat gracefully', () => {
    const history = mem.get('nonexistent');
    assert.ok(Array.isArray(history));
    assert.equal(history.length, 0);
  });
});
