cat > ~/visa-agent/full_audit.sh << 'EOF'
#!/bin/bash

echo "=========================================="
echo "OpenClaw Visa Bot – Full System Audit"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# 1. Directory and critical files
echo "1. Checking project structure..."
[ -d ~/visa-agent ] && pass "visa-agent directory exists" || fail "visa-agent directory missing"
[ -f ~/visa-agent/monitor-production.js ] && pass "monitor-production.js exists" || warn "monitor-production.js missing"
[ -f ~/visa-agent/correct-monitor.js ] && pass "correct-monitor.js exists" || warn "correct-monitor.js missing"
[ -d ~/visa-agent/tls-simulation ] && pass "tls-simulation directory exists" || warn "tls-simulation missing"
[ -f ~/visa-agent/tls-simulation/index.html ] && pass "simulation index.html exists" || warn "simulation index.html missing"

# 2. Node.js and npm
echo ""
echo "2. Checking runtime..."
NODE_VER=$(node -v 2>/dev/null)
if [ -n "$NODE_VER" ]; then
    pass "Node.js $NODE_VER installed"
else
    fail "Node.js not found"
fi
NPM_VER=$(npm -v 2>/dev/null)
if [ -n "$NPM_VER" ]; then
    pass "npm $NPM_VER installed"
else
    warn "npm not found"
fi

# 3. Playwright
echo ""
echo "3. Checking Playwright..."
if [ -d ~/visa-agent/node_modules/playwright ]; then
    pass "Playwright module installed"
else
    warn "Playwright not installed – run: npm install playwright"
fi
if [ -d ~/.cache/ms-playwright ]; then
    pass "Playwright browsers cached"
else
    warn "Playwright browsers not cached – run: npx playwright install chromium"
fi

# 4. Chrome remote debugging
echo ""
echo "4. Checking Chrome with remote debugging..."
if pgrep -f "google-chrome.*remote-debugging-port=9222" > /dev/null; then
    pass "Chrome with remote debugging is running"
    # Try to connect to CDP
    if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
        pass "CDP endpoint reachable on port 9222"
    else
        warn "CDP endpoint not reachable (Chrome may not be fully initialized)"
    fi
else
    warn "Chrome with remote debugging NOT running"
    echo "   Start it with: google-chrome --remote-debugging-port=9222 --user-data-dir=/home/samsepi0l/.config/google-chrome/tls-work"
fi

# 5. Log server (port 8080)
echo ""
echo "5. Checking log server (port 8080)..."
if lsof -i :8080 > /dev/null 2>&1; then
    pass "Something is listening on port 8080"
    # Try to detect if it's our Node log server
    if curl -s http://127.0.0.1:8080/ > /dev/null 2>&1; then
        pass "HTTP server responds on port 8080"
    else
        warn "Port 8080 occupied but not serving HTTP – may be a conflict"
    fi
else
    warn "Nothing on port 8080 – simulation log server not running"
    echo "   Start it with: cd ~/visa-agent/tls-simulation && node log-server.js &"
fi

# 6. Telegram connectivity (using environment variable or token in file)
echo ""
echo "6. Checking Telegram bot..."
# Try to source .env if exists
if [ -f ~/visa-agent/.env ]; then
    source ~/visa-agent/.env
fi
TOKEN="${TELEGRAM_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f ~/visa-agent/correct-monitor.js ]; then
    TOKEN=$(grep -oP "TELEGRAM_TOKEN = '\\K[^']+" ~/visa-agent/correct-monitor.js 2>/dev/null | head -1)
fi
if [ -n "$TOKEN" ] && [ "$TOKEN" != "YOUR_TOKEN_HERE" ]; then
    pass "Telegram token found (${TOKEN:0:10}...)"
    # Test the token
    RESP=$(curl -s "https://api.telegram.org/bot$TOKEN/getMe" 2>/dev/null)
    if echo "$RESP" | grep -q '"ok":true'; then
        pass "Telegram bot token is valid"
    else
        fail "Telegram bot token is invalid or revoked – revoke and create new one"
    fi
else
    warn "No valid Telegram token found – notifications will not work"
fi

# 7. Cloudflare block test (real TLScontact URL)
echo ""
echo "7. Testing Cloudflare connectivity to real site..."
REAL_URL="https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"
# Use a standard user-agent
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" "$REAL_URL" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    pass "Reached TLScontact (HTTP 200) – no Cloudflare block"
elif [ "$HTTP_CODE" = "403" ]; then
    fail "Cloudflare block detected (403) – need to use real Chrome session"
else
    warn "Unexpected HTTP code: $HTTP_CODE – may be blocked or unreachable"
fi

# 8. Git status
echo ""
echo "8. Checking Git repository..."
cd ~/visa-agent
if [ -d .git ]; then
    pass "Git repository exists"
    BRANCH=$(git branch --show-current)
    echo "   Current branch: $BRANCH"
    STATUS=$(git status -s)
    if [ -n "$STATUS" ]; then
        warn "Uncommitted changes:"
        echo "$STATUS" | sed 's/^/     /'
    else
        pass "Working tree clean"
    fi
    # Check if remote is set
    if git remote -v | grep -q origin; then
        pass "Remote 'origin' configured"
    else
        warn "No remote 'origin' configured"
    fi
else
    warn "Not a Git repository"
fi

# 9. Environment summary
echo ""
echo "9. Environment summary"
echo "   User: $(whoami)"
echo "   Home: $HOME"
echo "   OS: $(uname -a | cut -d' ' -f1-3)"
echo "   Display: ${DISPLAY:-not set}"
echo "   XAUTHORITY: ${XAUTHORITY:-not set}"

# 10. Suggestion if Cloudflare blocked
if [ "$HTTP_CODE" = "403" ]; then
    echo ""
    echo "=========================================="
    echo "⚠️  Cloudflare Block Detected"
    echo "=========================================="
    echo "Your normal browser may be blocked. Use the monitor's Chrome profile instead:"
    echo "   google-chrome --remote-debugging-port=9222 --user-data-dir=/home/samsepi0l/.config/google-chrome/tls-work"
    echo "Then log in manually and keep the window open. The bot will use that session."
fi

echo ""
echo "=========================================="
echo "Audit completed at $(date)"
echo "=========================================="
EOF

chmod +x ~/visa-agent/full_audit.sh
