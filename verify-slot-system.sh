#!/bin/bash
echo "=========================================="
echo "Slot Monitoring System Verification"
echo "=========================================="

# 1. Check if curl works
echo -n "1. curl reachable? "
if curl -s -o /dev/null -w "%{http_code}" "https://visas-pt.tlscontact.com" | grep -q "200\|302\|403"; then
    echo "✅ Yes (HTTP $(curl -s -o /dev/null -w "%{http_code}" "https://visas-pt.tlscontact.com"))"
else
    echo "❌ No - network issue"
fi

# 2. Check if xdotool is installed
echo -n "2. xdotool installed? "
if command -v xdotool &> /dev/null; then
    echo "✅ Yes"
else
    echo "❌ No - run: sudo apt install xdotool"
fi

# 3. Find Chrome window with TLScontact page
echo -n "3. Chrome window with TLScontact open? "
WINDOW_ID=$(xdotool search --name "TLScontact" | head -1)
if [ -n "$WINDOW_ID" ]; then
    echo "✅ Yes (window ID: $WINDOW_ID)"
else
    echo "⚠️ No - open the appointment page in Chrome and keep it visible"
fi

# 4. Check Telegram credentials in environment
echo -n "4. Telegram token set? "
if [ -n "$TELEGRAM_TOKEN" ] && [ "$TELEGRAM_TOKEN" != "your_token" ]; then
    echo "✅ Yes"
else
    echo "❌ No - run: export TELEGRAM_TOKEN='your_token'"
fi

echo -n "5. Telegram chat ID set? "
if [ -n "$TELEGRAM_ALLOWED_USER_ID" ] && [ "$TELEGRAM_ALLOWED_USER_ID" != "your_id" ]; then
    echo "✅ Yes"
else
    echo "❌ No - run: export TELEGRAM_ALLOWED_USER_ID='your_id'"
fi

# 6. Check if slot-watcher script exists and is executable
echo -n "6. slot-watcher.sh ready? "
if [ -x ~/visa-agent/slot-watcher.sh ]; then
    echo "✅ Yes"
else
    echo "❌ No - run: chmod +x ~/visa-agent/slot-watcher.sh"
fi

echo "=========================================="
echo "If all checks pass, run: ./slot-watcher.sh"
echo "Keep Chrome open on the appointment page."
echo "=========================================="
