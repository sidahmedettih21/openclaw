#!/bin/bash
# Verification script for visa-agent system

set -e

echo "=========================================="
echo "Visa Agent Verification"
echo "=========================================="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠ WARN${NC} $1"; }

# 1. Project structure
echo -e "\n1. Checking project structure..."
[ -d ~/visa-agent ] && pass "visa-agent directory exists" || fail "visa-agent directory missing"
[ -d ~/visa-agent/src ] && pass "src directory exists" || fail "src directory missing"
[ -f ~/visa-agent/src/server.ts ] && pass "server.ts exists" || fail "server.ts missing"
[ -d ~/visa-agent/visa_data ] && pass "visa_data directory exists" || fail "visa_data directory missing"
[ -d ~/visa-agent/logs ] && pass "logs directory exists" || warn "logs directory missing (will be created on first run)"
[ -d ~/visa-agent/screenshots ] && pass "screenshots directory exists" || warn "screenshots directory missing (will be created on first run)"

# 2. .env file
echo -e "\n2. Checking .env configuration..."
if [ -f ~/visa-agent/.env ]; then
    pass ".env file exists"
    source ~/visa-agent/.env
    if [ -n "$TELEGRAM_TOKEN" ] && [ "$TELEGRAM_TOKEN" != "PUT_YOUR_BOT_TOKEN_HERE" ]; then
        pass "TELEGRAM_TOKEN is set"
    else
        warn "TELEGRAM_TOKEN is missing or still placeholder"
    fi
    if [ -n "$TELEGRAM_ALLOWED_USER_ID" ] && [ "$TELEGRAM_ALLOWED_USER_ID" != "PUT_YOUR_NUMERIC_ID_HERE" ]; then
        pass "TELEGRAM_ALLOWED_USER_ID is set"
    else
        warn "TELEGRAM_ALLOWED_USER_ID is missing or still placeholder"
    fi
    [ -n "$PASSPHRASE" ] && [ "$PASSPHRASE" != "CHANGE_ME_TO_48_HEX_CHARS" ] && pass "PASSPHRASE is set" || fail "PASSPHRASE is missing or still placeholder"
    [ -n "$CHROME_USER_DATA" ] && pass "CHROME_USER_DATA is set" || warn "CHROME_USER_DATA not set"
    [ -n "$CHROME_PROFILE" ] && pass "CHROME_PROFILE is set" || warn "CHROME_PROFILE not set"
else
    fail ".env file missing"
fi

# 3. Client data
echo -e "\n3. Checking client data..."
if [ -f ~/visa_data/client.enc ]; then
    pass "client.enc exists"
    if command -v npx &> /dev/null; then
        cd ~/visa-agent
        if npx tsx --eval "import { loadAndDecrypt } from './src/server.ts'; loadAndDecrypt(process.env.PASSPHRASE, process.env.HOME + '/visa_data/client.enc'); console.log('OK');" 2>/dev/null | grep -q "OK"; then
            pass "client.enc decrypts successfully"
        else
            warn "client.enc decryption failed – passphrase mismatch or corruption"
        fi
    else
        warn "npx not found – skipping decryption test"
    fi
else
    warn "client.enc missing – you need to create it with real client data"
fi

# 4. Browser profile
echo -e "\n4. Checking browser profile..."
CHROME_DATA="${CHROME_USER_DATA:-$HOME/.config/google-chrome}"
PROFILE="${CHROME_PROFILE:-tls-work}"
PROFILE_PATH="$CHROME_DATA/$PROFILE"
if [ -d "$PROFILE_PATH" ]; then
    pass "Browser profile exists at $PROFILE_PATH"
    if [ -f "$PROFILE_PATH/Cookies" ] || [ -f "$PROFILE_PATH/Default/Cookies" ]; then
        pass "Session cookies found"
    else
        warn "No cookies found – you may need to log in manually once"
    fi
else
    warn "Browser profile not found at $PROFILE_PATH – run: openclaw browser --profile tls-work start and log in"
fi

# 5. Systemd service
echo -e "\n5. Checking systemd service..."
if systemctl --user is-active --quiet visa-agent; then
    pass "visa-agent service is running"
else
    warn "visa-agent service is not running – check with: systemctl --user status visa-agent"
fi

# 6. Health endpoint
echo -e "\n6. Checking health endpoint..."
if curl -s http://127.0.0.1:7432/health > /dev/null 2>&1; then
    pass "Health endpoint responds"
    HEALTH=$(curl -s http://127.0.0.1:7432/health)
    echo "   Health response: $HEALTH"
else
    warn "Health endpoint not reachable – service may not be running or port blocked"
fi

# 7. OpenClaw skill
echo -e "\n7. Checking OpenClaw skill..."
if [ -d ~/.openclaw/workspace/skills/visa-tls-run ]; then
    pass "OpenClaw skill directory exists"
    if [ -f ~/.openclaw/workspace/skills/visa-tls-run/SKILL.md ]; then
        pass "SKILL.md exists"
    else
        warn "SKILL.md missing"
    fi
else
    warn "OpenClaw skill not installed – you may need to create it"
fi

# 8. Playwright browsers
echo -e "\n8. Checking Playwright browsers..."
if [ -d ~/.cache/ms-playwright ]; then
    pass "Playwright browsers cached"
else
    warn "Playwright browsers not cached – run: npx playwright install chromium"
fi

# 9. Running process
echo -e "\n9. Checking running processes..."
if pgrep -f "tsx src/server.ts" > /dev/null; then
    pass "visa-agent process is running"
else
    warn "visa-agent process not found – service may be stopped"
fi

# 10. Node version
echo -e "\n10. Checking Node.js version..."
NODE_VER=$(node --version 2>/dev/null || echo "not found")
if [[ "$NODE_VER" =~ v2[0-9] ]]; then
    pass "Node version $NODE_VER (OK)"
else
    warn "Node version $NODE_VER – recommend 20+"
fi

echo -e "\n=========================================="
echo "Verification complete."
echo "=========================================="
echo ""
echo "Next steps if all passed:"
echo "  - Test the service manually: curl -X POST http://127.0.0.1:7432/run"
echo "  - Watch logs: journalctl --user -u visa-agent -f"
echo "  - Or trigger via OpenClaw: openclaw run visa-tls-run"
echo ""
echo "If any checks failed, fix them before proceeding."
