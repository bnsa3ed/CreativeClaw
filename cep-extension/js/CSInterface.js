/**
 * CSInterface.js — Adobe CEP Host Communication Interface
 *
 * This file is provided by Adobe and must be downloaded from:
 * https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_11.x/CSInterface.js
 *
 * Copy the file contents here before packaging the extension.
 *
 * Version: CEP 11 (compatible with CC 2022–2025)
 *
 * To install manually for development, run:
 *   curl -o cep-extension/js/CSInterface.js \
 *     https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js
 */

// Minimal stub for development/testing outside Adobe
if (typeof CSInterface === 'undefined') {
  window.CSInterface = class CSInterface {
    constructor() {
      this.hostEnvironment = { appId: 'PHXS', appVersion: '24.0' };
    }
    evalScript(script, callback) {
      console.log('[CSInterface stub] evalScript:', script.slice(0, 100) + '...');
      if (callback) callback(JSON.stringify({ ok: true, simulated: true }));
    }
    getHostEnvironment() { return this.hostEnvironment; }
    addEventListener() {}
    removeEventListener() {}
  };
  console.warn('[CreativeClaw CEP] Running with CSInterface stub — not inside Adobe.');
}
