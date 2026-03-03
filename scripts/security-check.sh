#!/usr/bin/env bash
# CreativeClaw Security Checklist
# Scans for common security issues and produces a PASS/FAIL report.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
WARN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)) || true; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)) || true; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARN++)) || true; }

echo "╔══════════════════════════════════════════════╗"
echo "║   CreativeClaw Security Check                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── 1. Hardcoded Secrets Scan ───────────────────────────────────────────────
echo "── 1. Hardcoded secrets scan ──────────────────"

SECRET_PATTERNS=(
  'sk-[a-zA-Z0-9]{20,}'           # OpenAI-style API keys
  'AAAA[A-Za-z0-9_-]{100,}'       # Firebase / GCM tokens
  'ghp_[a-zA-Z0-9]{36}'           # GitHub personal tokens
  'xoxb-[0-9]+-[a-zA-Z0-9]+'      # Slack bot tokens
  'bot[0-9]+:[a-zA-Z0-9_-]{35}'   # Telegram bot tokens
  'AIza[a-zA-Z0-9_-]{35}'         # Google API keys
  'password\s*=\s*["'"'"'][^"'"'"']+["'"'"']'  # Inline passwords
  'secret\s*=\s*["'"'"'][^"'"'"']+["'"'"']'    # Inline secrets
)

EXCLUDE_DIRS=".git node_modules dist"
EXCLUDE_ARGS=()
for d in $EXCLUDE_DIRS; do
  EXCLUDE_ARGS+=(--exclude-dir="$d")
done

FOUND_SECRETS=0
for pattern in "${SECRET_PATTERNS[@]}"; do
  if grep -rqE "$pattern" "${EXCLUDE_ARGS[@]}" "$REPO_ROOT/packages" "$REPO_ROOT/apps" 2>/dev/null; then
    fail "Possible hardcoded secret matching pattern: $pattern"
    FOUND_SECRETS=1
  fi
done

# Also check .env files committed to git
if git -C "$REPO_ROOT" ls-files | grep -qE '\.env$'; then
  fail ".env file is tracked by git — remove it and add to .gitignore"
  FOUND_SECRETS=1
fi

[[ $FOUND_SECRETS -eq 0 ]] && pass "No hardcoded secrets found"

# ─── 2. Required Env Vars Documented ────────────────────────────────────────
echo ""
echo "── 2. Required env vars documentation ────────"

ENV_EXAMPLE="$REPO_ROOT/.env.example"
if [[ -f "$ENV_EXAMPLE" ]]; then
  pass ".env.example exists"
else
  warn ".env.example not found — consider documenting required env vars"
fi

REQUIRED_VARS=(
  "TELEGRAM_BOT_TOKEN"
  "CREATIVECLAW_OWNER_ID"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -f "$ENV_EXAMPLE" ]] && grep -q "$var" "$ENV_EXAMPLE"; then
    pass "  $var documented in .env.example"
  else
    warn "  $var not found in .env.example (required var)"
  fi
done

# ─── 3. Debug / Development Endpoints ───────────────────────────────────────
echo ""
echo "── 3. Debug endpoint check ────────────────────"

DEBUG_PATTERNS=(
  '/debug'
  '/dev/'
  '__debug__'
  'DEBUG_MODE'
  'process\.env\.NODE_ENV.*===.*development'
)

FOUND_DEBUG=0
for pattern in "${DEBUG_PATTERNS[@]}"; do
  MATCHES=$(grep -rnE "$pattern" "${EXCLUDE_ARGS[@]}" \
    --include="*.ts" --include="*.js" \
    "$REPO_ROOT/packages" "$REPO_ROOT/apps" 2>/dev/null | \
    grep -v '\.test\.' | grep -v spec | head -3)
  if [[ -n "$MATCHES" ]]; then
    warn "Potential debug code/endpoint: $pattern"
    echo "$MATCHES" | sed 's/^/         /'
    FOUND_DEBUG=1
  fi
done

[[ $FOUND_DEBUG -eq 0 ]] && pass "No unguarded debug endpoints detected"

# ─── 4. .gitignore Covers Sensitive Files ───────────────────────────────────
echo ""
echo "── 4. .gitignore coverage ─────────────────────"

GITIGNORE="$REPO_ROOT/.gitignore"
SENSITIVE_ENTRIES=(".env" "*.pem" "*.key" "*.p12" "*.pfx" "dist/" "node_modules/")

if [[ ! -f "$GITIGNORE" ]]; then
  fail ".gitignore not found"
else
  for entry in "${SENSITIVE_ENTRIES[@]}"; do
    if grep -qF "$entry" "$GITIGNORE"; then
      pass "  $entry is in .gitignore"
    else
      warn "  $entry not found in .gitignore"
    fi
  done
fi

# ─── 5. npm / pnpm Audit ─────────────────────────────────────────────────────
echo ""
echo "── 5. Dependency vulnerability audit ──────────"

cd "$REPO_ROOT"
AUDIT_OUTPUT=$(pnpm audit --json 2>/dev/null || npm audit --json 2>/dev/null || echo '{"metadata":{"vulnerabilities":{"critical":0,"high":0,"moderate":0}}}')

CRITICAL=$(echo "$AUDIT_OUTPUT" | grep -o '"critical":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
HIGH=$(echo "$AUDIT_OUTPUT" | grep -o '"high":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
MODERATE=$(echo "$AUDIT_OUTPUT" | grep -o '"moderate":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")

if [[ "$CRITICAL" -gt 0 ]]; then
  fail "  $CRITICAL critical vulnerabilities found — run: pnpm audit --fix"
elif [[ "$HIGH" -gt 0 ]]; then
  fail "  $HIGH high vulnerabilities found — run: pnpm audit"
elif [[ "$MODERATE" -gt 0 ]]; then
  warn "  $MODERATE moderate vulnerabilities — review with: pnpm audit"
else
  pass "No critical or high vulnerabilities found"
fi

# ─── 6. TypeScript Strict Mode ──────────────────────────────────────────────
echo ""
echo "── 6. TypeScript strict mode ──────────────────"

if grep -q '"strict": true' "$REPO_ROOT/tsconfig.base.json" 2>/dev/null; then
  pass "TypeScript strict mode enabled in tsconfig.base.json"
else
  warn "TypeScript strict mode not confirmed in tsconfig.base.json"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${GREEN}PASS: $PASS${NC}  |  ${RED}FAIL: $FAIL${NC}  |  ${YELLOW}WARN: $WARN${NC}"
echo "══════════════════════════════════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}❌ Security check FAILED — $FAIL issue(s) must be resolved.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ Security check PASSED${NC}$([ $WARN -gt 0 ] && echo " (with $WARN warning(s))" || echo "")."
  exit 0
fi
