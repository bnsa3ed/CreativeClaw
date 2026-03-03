// CreativeClaw CSInterface stub
// ─────────────────────────────────────────────────────────────────────────────
// This is a placeholder. The real CSInterface.js must be downloaded from Adobe:
//   https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js
//
// To install automatically, run:
//   bash scripts/install-cep.sh
//
// Or download manually and replace this file.
// ─────────────────────────────────────────────────────────────────────────────

(function() {
  'use strict';

  /**
   * Minimal CSInterface stub — enough to prevent JS errors in the browser
   * preview, but will NOT work inside real Adobe apps.
   * Run `bash scripts/install-cep.sh` to get the real implementation.
   */
  function CSInterface() {
    console.warn(
      '[CreativeClaw] CSInterface stub loaded — run `bash scripts/install-cep.sh` ' +
      'to install the real Adobe CSInterface.js for production use.'
    );
  }

  CSInterface.prototype.evalScript = function(script, callback) {
    console.warn('[CSInterface stub] evalScript called — not in Adobe context');
    if (typeof callback === 'function') callback('[CSInterface stub]');
  };

  CSInterface.prototype.addEventListener = function(type, listener) {
    console.warn('[CSInterface stub] addEventListener called — not in Adobe context');
  };

  CSInterface.prototype.removeEventListener = function(type, listener) {};

  CSInterface.prototype.dispatchEvent = function(event) {};

  CSInterface.prototype.getHostEnvironment = function() {
    return { appName: 'UnknownApp', appVersion: '0.0', appLocale: 'en_US' };
  };

  CSInterface.prototype.closeExtension = function() {};

  CSInterface.prototype.getSystemPath = function(pathType) { return ''; };

  CSInterface.prototype.requestOpenExtension = function(extensionId, params) {};

  CSInterface.prototype.setContextMenuByJSON = function(menu, callback) {};

  CSInterface.prototype.updateContextMenuItem = function(id, enabled, checked) {};

  // Expose globally
  if (typeof window !== 'undefined') window.CSInterface = CSInterface;
  if (typeof module !== 'undefined') module.exports = CSInterface;
})();
