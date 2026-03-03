#!/usr/bin/env bash
# CreativeClaw — One-command install script (Linux/macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/bnsa3ed/CreativeClaw/main/scripts/install.sh | bash

set -euo pipefail

REPO_URL="https://github.com/bnsa3ed/CreativeClaw.git"
INSTALL_DIR="${CREATIVECLAW_DIR:-$HOME/.creativeclaw-install}"
VERSION="${CREATIVECLAW_VERSION:-main}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[CC]${NC} $*"; }
warn()  { echo -e "${YELLOW}[CC]${NC} $*"; }
error() { echo -e "${RED}[CC]${NC} $*" >&2; }

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

info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { error "Node.js 22+ is required. Install from https://nodejs.org"; exit 1; }
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

# ─── Clone ───────────────────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning CreativeClaw into $INSTALL_DIR..."
  git clone --branch "$VERSION" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ─── Install deps ────────────────────────────────────────────────────────────

info "Installing dependencies..."
if $HAS_PNPM; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
else
  npm install
fi

# ─── Build ───────────────────────────────────────────────────────────────────

info "Building..."
if $HAS_PNPM; then
  pnpm build
else
  npm run build
fi

# ─── Config ──────────────────────────────────────────────────────────────────

ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  warn "Created $ENV_FILE — fill in your TELEGRAM_BOT_TOKEN and CREATIVECLAW_OWNER_ID"
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
info "✅ CreativeClaw installed at $INSTALL_DIR"
echo ""
echo "  Next steps:"
echo "    1. Edit $ENV_FILE with your config"
echo "    2. Start the gateway:"
echo "       cd $INSTALL_DIR && node dist/apps/gateway/src/index.js"
echo "    3. Start the dashboard (optional):"
echo "       cd $INSTALL_DIR && node dist/apps/dashboard/src/index.js"
echo "    4. Start the local Adobe worker (on your desktop):"
echo "       cd $INSTALL_DIR && node dist/apps/worker-local/src/index.js"
echo ""
echo "  Or use Docker:"
echo "    cp .env.example .env && docker compose up -d"
echo ""
