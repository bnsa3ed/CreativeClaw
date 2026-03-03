#!/usr/bin/env bash
# CreativeClaw — One-command install script (macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/bnsa3ed/CreativeClaw/main/scripts/install.sh | bash

set -euo pipefail

REPO_URL="https://github.com/bnsa3ed/CreativeClaw.git"
INSTALL_DIR="${CREATIVECLAW_DIR:-$HOME/.creativeclaw-install}"
VERSION="${CREATIVECLAW_VERSION:-main}"
BIN_LINK="/usr/local/bin/creativeclaw"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${GREEN}[CC]${NC} $*"; }
warn()    { echo -e "${YELLOW}[CC]${NC} $*"; }
error()   { echo -e "${RED}[CC]${NC} $*" >&2; }
section() { echo -e "\n${CYAN}── $* ─────────────────────────────────${NC}"; }

echo ""
echo "  ██████╗██████╗ ███████╗ █████╗ ████████╗██╗██╗   ██╗███████╗"
echo " ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██║██║   ██║██╔════╝"
echo " ██║     ██████╔╝█████╗  ███████║   ██║   ██║██║   ██║█████╗  "
echo " ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██║╚██╗ ██╔╝██╔══╝  "
echo " ╚██████╗██║  ██║███████╗██║  ██║   ██║   ██║ ╚████╔╝ ███████╗"
echo "  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝  ╚══════╝"
echo "  CreativeClaw — AI agent for Adobe creative workflows"
echo ""

# ─── Prerequisites ───────────────────────────────────────────────────────────

section "Checking prerequisites"

command -v node >/dev/null 2>&1 || {
  error "Node.js 22+ is required. Install from https://nodejs.org"
  exit 1
}
NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 22 ]; then
  error "Node.js 22+ required (found $(node --version)). Upgrade at https://nodejs.org"
  exit 1
fi
info "Node.js $(node --version) ✓"

command -v git >/dev/null 2>&1 || { error "git is required."; exit 1; }
info "Git $(git --version | cut -d' ' -f3) ✓"

# pnpm (prefer) or npm
HAS_PNPM=false
if command -v pnpm >/dev/null 2>&1; then
  HAS_PNPM=true
  info "pnpm $(pnpm --version) ✓"
else
  warn "pnpm not found — will use npm. Install pnpm for faster installs: npm i -g pnpm"
fi

# ─── Clone / update ──────────────────────────────────────────────────────────

section "Installing CreativeClaw"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning into $INSTALL_DIR..."
  git clone --branch "$VERSION" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ─── Install deps ────────────────────────────────────────────────────────────

section "Installing dependencies"

if $HAS_PNPM; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
else
  npm install
fi
info "Dependencies installed ✓"

# ─── Build ───────────────────────────────────────────────────────────────────

section "Building"

if $HAS_PNPM; then
  pnpm build
else
  npm run build
fi
info "Build complete ✓"

# ─── CLI symlink ─────────────────────────────────────────────────────────────

section "Adding creativeclaw to PATH"

CLI_JS="$INSTALL_DIR/dist/apps/cli/src/index.js"

# Create a wrapper script so the user can just run `creativeclaw`
WRAPPER_CONTENT="#!/usr/bin/env bash
exec node \"$CLI_JS\" \"\$@\""

if [ -w "$(dirname "$BIN_LINK")" ] 2>/dev/null; then
  echo "$WRAPPER_CONTENT" > "$BIN_LINK"
  chmod +x "$BIN_LINK"
  info "creativeclaw command installed at $BIN_LINK ✓"
else
  # Try with sudo
  if command -v sudo >/dev/null 2>&1; then
    echo "$WRAPPER_CONTENT" | sudo tee "$BIN_LINK" > /dev/null
    sudo chmod +x "$BIN_LINK"
    info "creativeclaw command installed at $BIN_LINK ✓ (sudo)"
  else
    # Fallback: install to ~/.local/bin
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    BIN_LINK="$LOCAL_BIN/creativeclaw"
    echo "$WRAPPER_CONTENT" > "$BIN_LINK"
    chmod +x "$BIN_LINK"
    warn "Installed to $BIN_LINK — add this to your PATH:"
    warn "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    # Auto-add to shell profile if not already there
    for PROFILE in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [ -f "$PROFILE" ] && ! grep -q '.local/bin' "$PROFILE"; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
        warn "Added to $PROFILE — restart your terminal or run: source $PROFILE"
        break
      fi
    done
  fi
fi

# ─── Launch setup wizard ──────────────────────────────────────────────────────

section "Setup"

echo ""
info "Everything is installed. Launching the setup wizard now..."
echo ""

# Run setup wizard (interactive — reads from TTY)
if [ -t 0 ]; then
  node "$CLI_JS" setup
else
  # Non-interactive (piped install) — just show next steps
  warn "Non-interactive install detected."
  echo ""
  echo "  Run the setup wizard to finish:"
  echo "    creativeclaw setup"
  echo ""
fi

