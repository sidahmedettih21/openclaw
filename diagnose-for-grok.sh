#!/bin/bash
REPORT="/tmp/grok-report-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$REPORT") 2>&1

echo "=========================================="
echo "Grok Diagnostic Report – TLScontact Bot"
echo "Date: $(date)"
echo "Host: $(hostname)"
echo "User: $(whoami)"
echo "=========================================="

echo -e "\n--- 1. System info ---"
uname -a
lsb_release -a 2>/dev/null || cat /etc/os-release

echo -e "\n--- 2. Node & npm versions ---"
node --version
npm --version

echo -e "\n--- 3. OpenClaw version ---"
openclaw --version 2>/dev/null || echo "OpenClaw not in PATH"

echo -e "\n--- 4. OpenClaw config (redacted) ---"
if [ -f ~/.openclaw/openclaw.json ]; then
    sed 's/"token": "[^"]*"/"token": "REDACTED"/g' ~/.openclaw/openclaw.json
else
    echo "Config missing"
fi

echo -e "\n--- 5. visa-agent .env (redacted) ---"
if [ -f ~/visa-agent/.env ]; then
    sed 's/^TELEGRAM_TOKEN=.*/TELEGRAM_TOKEN=REDACTED/;
         s/^PASSPHRASE=.*/PASSPHRASE=REDACTED/' ~/visa-agent/.env
else
    echo ".env missing"
fi

echo -e "\n--- 6. visa-agent service status ---"
systemctl --user status visa-agent --no-pager -l

echo -e "\n--- 7. Last 50 lines of visa-agent log ---"
journalctl --user -u visa-agent -n 50 --no-pager

echo -e "\n--- 8. Browser profile status ---"
PROFILE="/home/samsepi0l/.config/google-chrome/tls-work"
if [ -d "$PROFILE" ]; then
    echo "Profile exists"
    ls -la "$PROFILE" | head -10
    echo "Cookies file exists: $([ -f "$PROFILE/Default/Cookies" ] && echo YES || echo NO)"
else
    echo "Profile missing"
fi

echo -e "\n--- 9. client.enc status ---"
if [ -f ~/visa_data/client.enc ]; then
    ls -l ~/visa_data/client.enc
else
    echo "client.enc missing"
fi

echo -e "\n--- 10. Network connectivity to TLScontact ---"
curl -I -s https://visas-pt.tlscontact.com | head -3

echo -e "\n--- 11. Running processes (visa-agent, openclaw) ---"
ps aux | grep -E "visa-agent|openclaw-gateway|tsx|node.*server.ts" | grep -v grep

echo -e "\n--- 12. Recent Telegram errors (from logs) ---"
journalctl --user -u visa-agent -n 100 --no-pager | grep -i "telegram\|notify\|failed" | tail -20

echo -e "\n=========================================="
echo "Report saved to: $REPORT"
echo "Please copy the entire output and send to Grok."
echo "=========================================="
