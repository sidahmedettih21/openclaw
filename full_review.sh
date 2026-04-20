#!/bin/bash
# Collect all configuration, logs, and environment for AI review

OUTPUT_FILE=~/visa-agent/review_$(date +%Y%m%d_%H%M%S).txt

echo "Generating full review at $OUTPUT_FILE"
exec > >(tee -a "$OUTPUT_FILE") 2>&1

echo "=========================================="
echo "Visa Agent Full Review"
echo "Date: $(date)"
echo "Host: $(hostname)"
echo "User: $(whoami)"
echo "=========================================="

# 1. System info
echo -e "\n--- SYSTEM INFO ---"
uname -a
lsb_release -a 2>/dev/null || cat /etc/os-release

# 2. Node and npm versions
echo -e "\n--- NODE / NPM ---"
node --version
npm --version

# 3. Playwright version
echo -e "\n--- PLAYWRIGHT ---"
npx playwright --version

# 4. OpenClaw version
echo -e "\n--- OPENCLAW ---"
openclaw --version 2>/dev/null || echo "OpenClaw not found in PATH"

# 5. .env file (redacted)
echo -e "\n--- .ENV (redacted) ---"
if [ -f ~/visa-agent/.env ]; then
    sed 's/^TELEGRAM_TOKEN=.*/TELEGRAM_TOKEN=REDACTED/;
         s/^PASSPHRASE=.*/PASSPHRASE=REDACTED/;
         s/^TELEGRAM_ALLOWED_USER_ID=.*/TELEGRAM_ALLOWED_USER_ID=REDACTED/' ~/visa-agent/.env
else
    echo ".env not found"
fi

# 6. Current config (openclaw.json redacted)
echo -e "\n--- OPENCLAW CONFIG (redacted) ---"
if [ -f ~/.openclaw/openclaw.json ]; then
    sed 's/"token": "[^"]*"/"token": "REDACTED"/g;
         s/"botToken": "[^"]*"/"botToken": "REDACTED"/g' ~/.openclaw/openclaw.json
else
    echo "openclaw.json not found"
fi

# 7. Verification script output
echo -e "\n--- VERIFICATION SCRIPT OUTPUT ---"
~/visa-agent/verify.sh

# 8. Last 50 lines of service log
echo -e "\n--- LAST 50 LINES OF SERVICE LOG ---"
journalctl --user -u visa-agent -n 50 --no-pager 2>/dev/null || echo "No logs found"

# 9. Browser profile details
echo -e "\n--- BROWSER PROFILE ---"
PROFILE_PATH="$HOME/.config/google-chrome/tls-work"
if [ -d "$PROFILE_PATH" ]; then
    ls -la "$PROFILE_PATH" | head -20
    echo "Profile size: $(du -sh "$PROFILE_PATH" | cut -f1)"
    echo "Cookies file exists: $([ -f "$PROFILE_PATH/Cookies" ] && echo YES || echo NO)"
else
    echo "Profile not found"
fi

# 10. Client data status
echo -e "\n--- CLIENT DATA ---"
if [ -f ~/visa_data/client.enc ]; then
    echo "client.enc exists, size: $(stat -c%s ~/visa_data/client.enc) bytes"
else
    echo "client.enc missing"
fi

# 11. Health endpoint
echo -e "\n--- HEALTH ENDPOINT ---"
curl -s http://127.0.0.1:7432/health || echo "Service not reachable"

# 12. Network connectivity to TLScontact
echo -e "\n--- NETWORK CHECK ---"
curl -I https://visas-pt.tlscontact.com 2>&1 | head -5

# 13. Running processes
echo -e "\n--- RUNNING PROCESSES ---"
ps aux | grep -E "tsx|visa-agent|openclaw" | grep -v grep

echo -e "\n=========================================="
echo "Review complete. File saved to: $OUTPUT_FILE"
echo "You can now copy the entire content of this file and paste it to Claude or Grok."
echo "=========================================="
