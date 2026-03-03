import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point data dir at a temp directory so we don't pollute the real DB
const tmpDir = mkdtempSync(join(tmpdir(), 'cc-auth-test-'));
process.env.CREATIVECLAW_DATA_DIR = tmpDir;
// Set a dummy master key so _ensureDefaultKey() doesn't print noise
process.env.CREATIVECLAW_API_KEY = 'cc_test_master_key';

const { AuthManager } = await import('../dist/packages/auth/src/index.js');

describe('AuthManager', () => {
  let mgr;
  let createdId;
  let createdKey;

  before(() => {
    mgr = new AuthManager();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a key and returns plaintext once', () => {
    const { key, record } = mgr.create('test-label');
    assert.ok(key.startsWith('cc_'), `key should start with cc_ but got: ${key}`);
    assert.equal(record.label, 'test-label');
    assert.ok(record.id, 'should have an id');
    createdId = record.id;
    createdKey = key;
  });

  it('lists the created key (without secret)', () => {
    const keys = mgr.list();
    const found = keys.find(k => k.id === createdId);
    assert.ok(found, 'created key should appear in list');
    // The public record should not have a key field
    assert.ok(!found.key, 'plaintext key must not appear in list');
    assert.ok(!found.keyHash, 'hash must not appear in list');
  });

  it('authenticates a valid key via Authorization header', () => {
    const fakeReq = { headers: { authorization: `Bearer ${createdKey}` }, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.equal(err, null, `should not return error for valid key, got: ${err}`);
  });

  it('authenticates a valid key via X-API-Key header', () => {
    const fakeReq = { headers: { 'x-api-key': createdKey }, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.equal(err, null);
  });

  it('authenticates via master CREATIVECLAW_API_KEY env', () => {
    const fakeReq = { headers: { authorization: 'Bearer cc_test_master_key' }, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.equal(err, null, 'master env key should pass');
  });

  it('rejects an invalid key', () => {
    const fakeReq = { headers: { authorization: 'Bearer cc_totally_wrong_key' }, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.ok(err, 'should return an error for invalid key');
    assert.equal(err, 'invalid_api_key');
  });

  it('returns missing_api_key when no key provided', () => {
    const fakeReq = { headers: {}, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.equal(err, 'missing_api_key');
  });

  it('bypasses auth for /health', () => {
    const fakeReq = { headers: {}, url: '/health' };
    assert.equal(mgr.authenticate(fakeReq), null);
  });

  it('bypasses auth for /metrics', () => {
    const fakeReq = { headers: {}, url: '/metrics' };
    assert.equal(mgr.authenticate(fakeReq), null);
  });

  it('bypasses auth for /telegram/inbound', () => {
    const fakeReq = { headers: {}, url: '/telegram/inbound' };
    assert.equal(mgr.authenticate(fakeReq), null);
  });

  it('revokes a key', () => {
    const ok = mgr.revoke(createdId);
    assert.equal(ok, true);
    const keys = mgr.list();
    const found = keys.find(k => k.id === createdId);
    // Key still exists but enabled=false
    assert.ok(found, 'key should still exist');
    assert.equal(found.enabled, false);
  });

  it('rejects the revoked key', () => {
    const fakeReq = { headers: { authorization: `Bearer ${createdKey}` }, url: '/jobs' };
    const err = mgr.authenticate(fakeReq);
    assert.ok(err, 'revoked key should be rejected');
  });

  it('deletes a key permanently', () => {
    const ok = mgr.delete(createdId);
    assert.equal(ok, true);
    const keys = mgr.list();
    assert.ok(!keys.find(k => k.id === createdId), 'deleted key should not appear');
  });
});
