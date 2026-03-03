/**
 * @creativeclaw/errors
 * Structured error catalog for the CreativeClaw platform.
 * Each error has a machine-readable code, HTTP status, and human-readable message.
 */

// ─── Error Codes ────────────────────────────────────────────────────────────

export const ErrorCodes = {
  /** Actor does not have permission to perform the action (RBAC failure) */
  ERR_FORBIDDEN: 'ERR_FORBIDDEN',
  /** Requested resource was not found */
  ERR_NOT_FOUND: 'ERR_NOT_FOUND',
  /** Request payload failed schema / type validation */
  ERR_VALIDATION: 'ERR_VALIDATION',
  /** Operation requires explicit approval before execution */
  ERR_APPROVAL_REQUIRED: 'ERR_APPROVAL_REQUIRED',
  /** Worker did not respond within the configured timeout window */
  ERR_WORKER_TIMEOUT: 'ERR_WORKER_TIMEOUT',
  /** Worker returned an unexpected or malformed response */
  ERR_WORKER_BAD_RESPONSE: 'ERR_WORKER_BAD_RESPONSE',
  /** Operation was rejected because a pending approval already exists */
  ERR_APPROVAL_CONFLICT: 'ERR_APPROVAL_CONFLICT',
  /** The approval token / ID is invalid or has expired */
  ERR_APPROVAL_INVALID: 'ERR_APPROVAL_INVALID',
  /** Internal unexpected error — check logs for details */
  ERR_INTERNAL: 'ERR_INTERNAL',
  /** Rate limit exceeded — too many requests */
  ERR_RATE_LIMIT: 'ERR_RATE_LIMIT',
  /** Adobe operation failed at the connector level */
  ERR_ADOBE_OPERATION: 'ERR_ADOBE_OPERATION',
  /** WebSocket bridge to Adobe is not connected */
  ERR_BRIDGE_UNAVAILABLE: 'ERR_BRIDGE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ─── HTTP Status Map ─────────────────────────────────────────────────────────

const httpStatusMap: Record<ErrorCode, number> = {
  ERR_FORBIDDEN: 403,
  ERR_NOT_FOUND: 404,
  ERR_VALIDATION: 400,
  ERR_APPROVAL_REQUIRED: 202,
  ERR_WORKER_TIMEOUT: 504,
  ERR_WORKER_BAD_RESPONSE: 502,
  ERR_APPROVAL_CONFLICT: 409,
  ERR_APPROVAL_INVALID: 400,
  ERR_INTERNAL: 500,
  ERR_RATE_LIMIT: 429,
  ERR_ADOBE_OPERATION: 500,
  ERR_BRIDGE_UNAVAILABLE: 503,
};

// ─── CreativeClawError Class ─────────────────────────────────────────────────

export class CreativeClawError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'CreativeClawError';
    this.code = code;
    this.httpStatus = httpStatusMap[code] ?? 500;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function forbidden(message = 'You do not have permission to perform this action.', details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_FORBIDDEN, message, details);
}

export function notFound(resource: string, details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_NOT_FOUND, `${resource} not found.`, details);
}

export function validation(message: string, details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_VALIDATION, message, details);
}

export function approvalRequired(operationId: string, approvalId?: string) {
  return new CreativeClawError(
    ErrorCodes.ERR_APPROVAL_REQUIRED,
    `Operation "${operationId}" requires approval before execution.`,
    { operationId, approvalId },
  );
}

export function workerTimeout(operationId: string, timeoutMs: number) {
  return new CreativeClawError(
    ErrorCodes.ERR_WORKER_TIMEOUT,
    `Worker did not respond within ${timeoutMs}ms for operation "${operationId}".`,
    { operationId, timeoutMs },
  );
}

export function workerBadResponse(message = 'Worker returned a malformed response.', details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_WORKER_BAD_RESPONSE, message, details);
}

export function approvalConflict(approvalId: string) {
  return new CreativeClawError(
    ErrorCodes.ERR_APPROVAL_CONFLICT,
    `A pending approval already exists with id "${approvalId}".`,
    { approvalId },
  );
}

export function approvalInvalid(approvalId: string) {
  return new CreativeClawError(
    ErrorCodes.ERR_APPROVAL_INVALID,
    `Approval "${approvalId}" is invalid or has expired.`,
    { approvalId },
  );
}

export function internal(message = 'An unexpected internal error occurred.', details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_INTERNAL, message, details);
}

export function rateLimit(retryAfterSeconds?: number) {
  return new CreativeClawError(
    ErrorCodes.ERR_RATE_LIMIT,
    'Rate limit exceeded. Please slow down.',
    retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined,
  );
}

export function adobeOperation(message: string, details?: unknown) {
  return new CreativeClawError(ErrorCodes.ERR_ADOBE_OPERATION, message, details);
}

export function bridgeUnavailable() {
  return new CreativeClawError(
    ErrorCodes.ERR_BRIDGE_UNAVAILABLE,
    'The Adobe WebSocket bridge is not connected. Ensure the local worker is running.',
  );
}

// ─── Guard ───────────────────────────────────────────────────────────────────

export function isCreativeClawError(err: unknown): err is CreativeClawError {
  return err instanceof CreativeClawError;
}
