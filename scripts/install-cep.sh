#!/usr/bin/env bash
# CreativeClaw CEP Extension Installer
# Installs the Adobe CEP companion panel into your Adobe CC apps.
# Run this once after installing CreativeClaw.
#
# Usage: bash scripts/install-cep.sh

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[CEP]${NC} $*"; }
warn()  { echo -e "${YELLOW}[CEP]${NC} $*"; }
error() { echo -e "${RED}[CEP]${NC} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEP_SRC="$SCRIPT_DIR/../cep-extension"
CSINTERFACE_URL="https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js"

echo ""
echo "  CreativeClaw — CEP Extension Installer"
echo ""

# ─── Platform detection ───────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Darwin)
    # macOS — system + user CEP paths
    CEP_SYSTEM="/Library/Application Support/Adobe/CEP/extensions"
    CEP_USER="$HOME/Library/Application Support/Adobe/CEP/extensions"
    ;;
  Linux)
    CEP_USER="$HOME/.adobe/CEP/extensions"
    CEP_SYSTEM="/etc/adobe/CEP/extensions"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    # Windows (Git Bash / WSL)
    CEP_USER="$APPDATA/Adobe/CEP/extensions"
    CEP_SYSTEM="$PROGRAMFILES/Adobe/CEP/extensions"
    ;;
  *)
    error "Unsupported OS: $OS"
    exit 1
    ;;
esac

DEST_DIR="$CEP_USER/CreativeClaw"

# ─── Download real CSInterface.js ─────────────────────────────────────────────

CSINTERFACE_DEST="$CEP_SRC/js/CSInterface.js"
STUB_MARKER="// CreativeClaw CSInterface stub"

# Check if current file is the stub (needs replacement)
if grep -q "$STUB_MARKER" "$CSINTERFACE_DEST" 2>/dev/null; then
  info "Downloading real CSInterface.js from Adobe CEP Resources..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$CSINTERFACE_URL" -o "$CSINTERFACE_DEST"
    info "CSInterface.js downloaded ✓"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$CSINTERFACE_URL" -O "$CSINTERFACE_DEST"
    info "CSInterface.js downloaded ✓"
  else
    warn "curl/wget not found — skipping CSInterface.js download."
    warn "Manually download from:"
    warn "  $CSINTERFACE_URL"
    warn "Save to: $CSINTERFACE_DEST"
  fi
else
  info "CSInterface.js already present ✓"
fi

# ─── Install extension ────────────────────────────────────────────────────────

info "Installing CEP extension to: $DEST_DIR"
mkdir -p "$DEST_DIR"
cp -r "$CEP_SRC/." "$DEST_DIR/"
info "Extension files copied ✓"

# ─── Enable unsigned extensions (required for dev installs) ──────────────────

info "Enabling unsigned extension loading in Adobe CC..."

if [[ "$OS" == "Darwin" ]]; then
  # macOS: set PlayerDebugMode via defaults
  PLIST_PATH="$HOME/Library/Preferences/com.adobe.CSXS.12.plist"
  defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :PlayerDebugMode string 1" "$PLIST_PATH" 2>/dev/null || \
    warn "Could not set PlayerDebugMode — you may need to do this manually."

  # Also set for other CSXS versions (10, 11) for older CC
  for V in 10 11; do
    defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1 2>/dev/null || true
  done
  info "PlayerDebugMode enabled ✓ (CSXS 10/11/12)"

elif [[ "$OS" == "Linux" ]]; then
  PREF_DIR="$HOME/.config/adobe/CSXS/12"
  mkdir -p "$PREF_DIR"
  cat > "$PREF_DIR/preferences.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<preferences>
  <PreferenceItem name="PlayerDebugMode" type="String" value="1"/>
</preferences>
EOF
  info "PlayerDebugMode enabled ✓ (Linux)"
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
info "✅ CEP Extension installed!"
echo ""
echo "  Next steps:"
echo "    1. Restart any open Adobe CC apps (Premiere, After Effects, etc.)"
echo "    2. Open the extension:  Window → Extensions → CreativeClaw"
echo "    3. The panel will connect automatically to your running worker"
echo ""
echo "  Extension path: $DEST_DIR"
echo ""
echo "  If the extension doesn't appear, check:"
echo "    • Adobe CC app is version 2022 or later"
echo "    • You restarted the app after install"
echo "    • PlayerDebugMode is set (see above)"
echo ""
