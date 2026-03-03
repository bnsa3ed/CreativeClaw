/**
 * Adobe operation handlers.
 * Execution order:
 *   1. Real Adobe via osascript (macOS) — requires Adobe app to be open
 *   2. Mock/simulation mode — returns a simulated ok response for CI/testing
 *
 * Set CREATIVECLAW_ADOBE_MOCK=true to force mock mode.
 */

import type { AdobeApp } from './index.js';
import { generateScript } from './extendscript-gen.js';
import { executeViaOsascript, isOsascriptAvailable } from './macos-bridge.js';

export interface ConnectorExecutionResult {
  ok: boolean;
  app: AdobeApp;
  operation: string;
  output?: unknown;
  error?: string;
  executionMode: 'real' | 'mock';
}

const MOCK_MODE = process.env.CREATIVECLAW_ADOBE_MOCK === 'true';

/** Simulate a successful operation (used in mock/test mode) */
function mockResult(app: AdobeApp, operation: string, payload?: Record<string, unknown>): ConnectorExecutionResult {
  return {
    ok: true,
    app,
    operation,
    output: {
      simulated: true,
      note: 'Running in mock mode — set CREATIVECLAW_ADOBE_MOCK=false and open the Adobe app for real execution.',
      appliedPayload: payload,
    },
    executionMode: 'mock',
  };
}

/**
 * Execute an Adobe operation.
 * - Generates ExtendScript for the operation
 * - Tries real execution via osascript
 * - Falls back to mock if the app is not running or CREATIVECLAW_ADOBE_MOCK=true
 */
export async function runConnectorOperation(
  app: AdobeApp,
  operation: string,
  payload?: Record<string, unknown>,
): Promise<ConnectorExecutionResult> {
  const p = payload || {};

  // Generate the ExtendScript for this operation
  const jsx = generateScript(app, operation, p);

  if (!jsx) {
    return {
      ok: false,
      app,
      operation,
      error: `unsupported_operation: ${app}/${operation}`,
      executionMode: 'mock',
    };
  }

  // Skip real execution in mock mode or if not on macOS
  if (MOCK_MODE) {
    return mockResult(app, operation, p);
  }

  const hasOsascript = await isOsascriptAvailable();
  if (!hasOsascript) {
    // Not on macOS — fall back to mock
    return mockResult(app, operation, p);
  }

  // Attempt real execution
  try {
    const result = await executeViaOsascript(app, jsx, 30_000);

    if (!result.ok && result.error?.includes('not running')) {
      // Adobe app not open — return mock with a clear warning
      return {
        ok: false,
        app,
        operation,
        error: result.error,
        executionMode: 'real',
      };
    }

    return {
      ok: result.ok,
      app,
      operation,
      output: result.output,
      error: result.ok ? undefined : (result.error ?? 'unknown_error'),
      executionMode: 'real',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      app,
      operation,
      error: err instanceof Error ? err.message : String(err),
      executionMode: 'real',
    };
  }
}
