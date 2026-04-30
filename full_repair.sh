#!/bin/bash
set -e

echo "=========================================="
echo "OpenClaw Visa Bot – Full Repair"
echo "=========================================="

# 1. Kill any existing Chrome using the tls-work profile
echo "[1] Cleaning previous Chrome instances..."
pkill -f "google-chrome.*tls-work" 2>/dev/null || true
sleep 2
rm -f ~/.config/google-chrome/tls-work/SingletonLock

# 2. Fix the systemd service (remove misplaced Environment lines)
echo "[2] Repairing systemd service..."
SERVICE_FILE=~/.config/systemd/user/visa-agent.service
if [ -f "$SERVICE_FILE" ]; then
    # Remove Environment lines from [Install] section
    sed -i '/^Environment=/d' "$SERVICE_FILE"
    # Ensure Environment lines are under [Service]
    echo "Environment=DISPLAY=:0" >> "$SERVICE_FILE"
    echo "Environment=XAUTHORITY=/home/$USER/.Xauthority" >> "$SERVICE_FILE"
    echo "Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus" >> "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "Service file repaired."
else
    echo "Service file not found – will create later"
fi

# 3. Create a clean log server (Node.js) for the simulation
echo "[3] Setting up log server..."
mkdir -p ~/visa-agent/tls-simulation
cat > ~/visa-agent/tls-simulation/log-server.js << 'NJSERVER'
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/log-event') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { console.log('[LOG]', JSON.parse(body)); } catch(e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Missing index.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const PORT = 8080;
server.listen(PORT, () => console.log(`Log server running on http://localhost:${PORT}`));
NJSERVER

# 4. Ensure the simulation HTML exists (use a minimal one if missing)
if [ ! -f ~/visa-agent/tls-simulation/index.html ]; then
    echo "[4] Creating minimal simulation HTML (forceSlot will work)…"
    cp ~/visa-agent/tls-simulation/index.html.backup ~/visa-agent/tls-simulation/index.html 2>/dev/null || echo "HTML missing – please provide index.html"
fi

# 5. Remove hardcoded token from monitor-production.js if present (use env)
echo "[5] Checking monitor scripts for hardcoded tokens..."
sed -i 's/TELEGRAM_TOKEN = .*YOUR_TOKEN_HERE.*/TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";/' ~/visa-agent/monitor-production.js 2>/dev/null || true
sed -i 's/CHAT_ID = .*/CHAT_ID = process.env.CHAT_ID || "";/' ~/visa-agent/monitor-production.js 2>/dev/null || true

# 6. Start a fresh Chrome with remote debugging (keep it open)
echo "[6] Launching Chrome with remote debugging (headed)…"
google-chrome --remote-debugging-port=9222 --user-data-dir=/home/$USER/.config/google-chrome/tls-work &
sleep 5
echo "Chrome launched. Please log into TLScontact manually within the next 60 seconds."

# 7. Start the log server in background
echo "[7] Starting log server…"
cd ~/visa-agent/tls-simulation
pkill -f "node log-server.js" 2>/dev/null || true
node log-server.js &
sleep 2
cd -

# 8. Create a simple test script to verify detection
echo "[8] Creating test script…"
cat > ~/visa-agent/test_detection.sh << 'TESTEOF'
#!/bin/bash
echo "Testing connectivity to CDP…"
curl -s http://127.0.0.1:9222/json/version | grep -q "Browser" && echo "CDP OK" || echo "CDP FAIL – Chrome not listening"
TESTEOF
chmod +x ~/visa-agent/test_detection.sh

echo ""
echo "=========================================="
echo "Repair completed. Next steps:"
echo "1. In the Chrome window that opened, log into TLScontact and reach the appointment page."
echo "2. Run: cd ~/visa-agent && node monitor-production.js"
echo "3. Monitor logs: journalctl --user -u visa-agent -f (if using systemd) or watch terminal output."
echo "=========================================="
