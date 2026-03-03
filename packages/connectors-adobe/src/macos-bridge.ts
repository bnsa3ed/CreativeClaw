/**
 * macOS Adobe Bridge
 * Executes ExtendScript in Adobe apps via AppleScript / osascript.
 * Works for Premiere Pro, After Effects, Illustrator (and Photoshop fallback).
 * Requires macOS and the target Adobe application to be open.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdobeApp } from './index.js';

const execFileAsync = promisify(execFile);

/** Maps AdobeApp to the AppleScript application name (adjust for your installed CC version) */
const APP_NAMES: Record<AdobeApp, string[]> = {
  premiere: [
    'Adobe Premiere Pro 2025',
    'Adobe Premiere Pro 2024',
    'Adobe Premiere Pro 2023',
    'Adobe Premiere Pro 2022',
    'Adobe Premiere Pro',
  ],
  aftereffects: [
    'Adobe After Effects 2025',
    'Adobe After Effects 2024',
    'Adobe After Effects 2023',
    'Adobe After Effects 2022',
    'Adobe After Effects',
  ],
  photoshop: [
    'Adobe Photoshop 2025',
    'Adobe Photoshop 2024',
    'Adobe Photoshop 2023',
    'Adobe Photoshop 2022',
    'Adobe Photoshop',
  ],
  illustrator: [
    'Adobe Illustrator 2025',
    'Adobe Illustrator 2024',
    'Adobe Illustrator 2023',
    'Adobe Illustrator 2022',
    'Adobe Illustrator',
  ],
};

export interface BridgeResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  mode: 'osascript' | 'mock';
}

/** Check if a specific Adobe app is currently running */
export async function isAppRunning(app: AdobeApp): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', APP_NAMES[app][0].split(' ').slice(-2).join(' ')]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Escape a JSX string for embedding in an AppleScript string literal */
function escapeForAppleScript(jsx: string): string {
  // AppleScript string delimiters are quotes; escape backslashes and quotes
  return jsx.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

/** Try each known app name until one responds */
async function findRunningAppName(app: AdobeApp): Promise<string | null> {
  for (const name of APP_NAMES[app]) {
    const script = `tell application "System Events" to return name of processes whose name is "${name}"`;
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script]);
      if (stdout.trim().includes(name)) return name;
    } catch {
      continue;
    }
  }
  return null;
}

/** Execute ExtendScript in a running Adobe app via osascript */
export async function executeViaOsascript(
  app: AdobeApp,
  jsx: string,
  timeoutMs = 30_000,
): Promise<BridgeResult> {
  const appName = await findRunningAppName(app);
  if (!appName) {
    return {
      ok: false,
      error: `Adobe app not running: ${app}. Open ${APP_NAMES[app][0]} and try again.`,
      mode: 'osascript',
    };
  }

  const escaped = escapeForAppleScript(jsx);
  const appleScript = `tell application "${appName}" to do javascript "${escaped}"`;

  try {
    const { stdout, stderr } = await execFileAsync(
      'osascript',
      ['-e', appleScript],
      { timeout: timeoutMs },
    );

    const raw = stdout.trim() || stderr.trim();

    // Try to parse as JSON (our JSX scripts return JSON strings)
    try {
      const parsed = JSON.parse(raw);
      return { ok: parsed.ok !== false, output: parsed, mode: 'osascript' };
    } catch {
      // Non-JSON response — treat as raw string output
      return { ok: true, output: { raw }, mode: 'osascript' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Check for "Application isn't running" type errors
    if (msg.includes('not running') || msg.includes('Connection is invalid')) {
      return {
        ok: false,
        error: `${appName} is not responding. Make sure the application is open and not busy.`,
        mode: 'osascript',
      };
    }
    return { ok: false, error: msg, mode: 'osascript' };
  }
}

/** Photoshop-specific: use PS's built-in "do javascript" AppleScript command */
export async function executeInPhotoshop(jsx: string, timeoutMs = 30_000): Promise<BridgeResult> {
  return executeViaOsascript('photoshop', jsx, timeoutMs);
}

/** Whether osascript is available (i.e., we're on macOS) */
export async function isOsascriptAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['osascript']);
    return true;
  } catch {
    return false;
  }
}
