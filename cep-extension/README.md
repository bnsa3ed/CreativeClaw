# CreativeClaw CEP Bridge Extension

A lightweight Adobe CEP panel that connects your Adobe apps directly to the CreativeClaw gateway via WebSocket, enabling **real** bidirectional ExtendScript execution without needing osascript.

## Why this vs osascript?

| | osascript bridge | CEP extension |
|--|--|--|
| Platform | macOS only | macOS + Windows |
| App detection | Fragile version strings | Automatic (hostId) |
| Execution | Blocking | Async |
| Callbacks from Adobe | ❌ | ✅ |
| Event listening | ❌ | ✅ |
| Installation | None | One-time per machine |

## Prerequisites

- Adobe Creative Cloud (Premiere Pro, After Effects, Photoshop, or Illustrator) — CC 2022+
- CEP extensions enabled (see below)

## Enable unsigned extensions (dev mode)

**macOS:**
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
# Repeat for each app version (10, 9, etc.) you have installed
```

**Windows:**
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.11 → PlayerDebugMode = 1
```

## Install

1. **Get CSInterface.js** (required, not bundled due to Adobe license):
   ```bash
   curl -o cep-extension/js/CSInterface.js \
     https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js
   ```

2. **Copy the extension** to your Adobe extensions folder:

   **macOS (all users):**
   ```bash
   sudo cp -r cep-extension /Library/Application\ Support/Adobe/CEP/extensions/com.creativeclaw.bridge
   ```

   **macOS (current user only):**
   ```bash
   cp -r cep-extension ~/Library/Application\ Support/Adobe/CEP/extensions/com.creativeclaw.bridge
   ```

   **Windows:**
   ```
   C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.creativeclaw.bridge\
   ```

3. **Restart Adobe** — find the panel under **Window → Extensions → CreativeClaw Bridge**

4. **Connect** — the panel auto-connects to `ws://127.0.0.1:3789/ws/local`. Change the URL if your gateway runs elsewhere.

## How it works

```
Telegram/API → Gateway → WebSocket → CEP Panel → evalScript() → Adobe app
                                         ↑
                                    result JSON
```

The panel:
1. Connects to the gateway WebSocket on load
2. Sends `worker_hello` to register as a worker with the current app's capabilities
3. Receives `execute` messages from the gateway
4. Runs the ExtendScript via `evalScript()` inside the host Adobe app
5. Returns the JSON result as a `result` message

## Packaging for distribution

Use Adobe's `ZXPSignCmd` to sign and package:
```bash
ZXPSignCmd -sign cep-extension/ CreativeClaw-Bridge.zxp certificate.p12 password options.xml
```

Install `.zxp` files via the [Adobe Exchange panel](https://exchange.adobe.com/) or `ExManCmd`.
