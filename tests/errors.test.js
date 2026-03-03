/**
 * Unit tests for @creativeclaw/errors
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreativeClawError,
  ErrorCodes,
  forbidden,
  notFound,
  validation,
  approvalRequired,
  workerTimeout,
  approvalInvalid,
  internal,
  bridgeUnavailable,
  isCreativeClawError,
} from '../dist/packages/errors/src/index.js';

describe('CreativeClawError', () => {
  it('is an instance of Error', () => {
    const err = forbidden();
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CreativeClawError);
  });

  it('has a code, httpStatus, and message', () => {
    const err = forbidden();
    assert.equal(err.code, ErrorCodes.ERR_FORBIDDEN);
    assert.equal(err.httpStatus, 403);
    assert.ok(err.message.length > 0);
  });

  it('serializes to JSON with error + message', () => {
    const err = validation('Missing field', { field: 'userId' });
    const json = err.toJSON();
    assert.equal(json.error, 'ERR_VALIDATION');
    assert.equal(json.message, 'Missing field');
    assert.deepEqual(json.details, { field: 'userId' });
  });
});

describe('factory functions', () => {
  it('forbidden — 403', () => {
    assert.equal(forbidden().httpStatus, 403);
    assert.equal(forbidden().code, 'ERR_FORBIDDEN');
  });

  it('notFound — 404', () => {
    const err = notFound('User');
    assert.equal(err.httpStatus, 404);
    assert.ok(err.message.includes('User'));
  });

  it('approvalRequired — 202', () => {
    const err = approvalRequired('op-1', 'appr-42');
    assert.equal(err.httpStatus, 202);
    assert.equal(err.code, 'ERR_APPROVAL_REQUIRED');
    assert.deepEqual(err.details, { operationId: 'op-1', approvalId: 'appr-42' });
  });

  it('workerTimeout — 504', () => {
    const err = workerTimeout('op-2', 5000);
    assert.equal(err.httpStatus, 504);
    assert.ok(err.message.includes('5000ms'));
  });

  it('approvalInvalid — 400', () => {
    const err = approvalInvalid('appr-99');
    assert.equal(err.httpStatus, 400);
    assert.ok(err.message.includes('appr-99'));
  });

  it('internal — 500', () => {
    assert.equal(internal().httpStatus, 500);
  });

  it('bridgeUnavailable — 503', () => {
    assert.equal(bridgeUnavailable().httpStatus, 503);
  });
});

describe('isCreativeClawError', () => {
  it('returns true for CreativeClawError instances', () => {
    assert.ok(isCreativeClawError(forbidden()));
  });

  it('returns false for plain errors', () => {
    assert.equal(isCreativeClawError(new Error('plain')), false);
  });

  it('returns false for non-errors', () => {
    assert.equal(isCreativeClawError(null), false);
    assert.equal(isCreativeClawError('string'), false);
    assert.equal(isCreativeClawError(42), false);
  });
});
