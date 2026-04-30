#!/bin/bash
set -e
cd ~/visa-agent

echo "=== FINAL FIX: Correcting server.ts ==="

# Backup broken version
cp src/server.ts src/server.ts.broken

# Write corrected server.ts (network check moved to monitorAndBook, no misplaced code)
cat > src/server.ts << 'SERVEREOF'
// ============================================================
// TLScontact Appointment Slot Monitor – Corrected
// ============================================================
import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { chromium, type BrowserContext, type Page } from "playwright";
import TelegramBot from "node-telegram-bot-api";

const HOME = os.homedir();
const AGENT_DIR = path.join(HOME, "visa-agent");
const LOGS_DIR = path.join(AGENT_DIR, "logs");
const CSV_LOG = path.join(AGENT_DIR, "slot_checks.csv");
for (const d of [LOGS_DIR]) mkdirSync(d, { recursive: true });

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console({ format: format.simple() }),
    new transports.File({ filename: path.join(LOGS_DIR, "monitor.log"), maxsize: 10_000_000, maxFiles: 5 }),
  ],
});

function logToCSV(status: string, details: string = "") {
  const row = `${new Date().toISOString()},${status},${details}\n`;
  if (!existsSync(CSV_LOG)) writeFileSync(CSV_LOG, "timestamp,status,details\n");
  writeFileSync(CSV_LOG, row, { flag: "a" });
}

const ALLOWED_ID = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID!, 10);
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: false });

async function notify(text: string) {
  try { await bot.sendMessage(ALLOWED_ID, text, { parse_mode: "Markdown" }); }
  catch (e) { logger.error("Telegram failed", { error: String(e) }); }
}

async function sendScreenshot(imgPath: string, caption: string) {
  try { await bot.sendPhoto(ALLOWED_ID, imgPath, { caption }); }
  catch (e) { logger.error("Photo failed", { error: String(e) }); }
}

async function createContext(): Promise<BrowserContext> {
  const profilePath = path.join(
    process.env.CHROME_USER_DATA ?? path.join(HOME, ".config/google-chrome"),
    process.env.CHROME_PROFILE ?? "tls-work"
  );
  logger.info(`Launching browser with profile: ${profilePath}`);

  const ctx = await chromium.launchPersistentContext(profilePath, {
    executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-ipc-flooding-protection",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-web-security",
      "--disable-features=ChromeWhatsNewUI",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--disable-client-side-phishing-detection",
      "--disable-crash-reporter",
      "--disable-logging",
      "--disable-notifications",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-fake-ui-for-media-stream",
      "--window-size=1280,800",
      "--start-maximized",
      "--lang=en-US",
      "--flag-switches-begin",
      "--disable-features=OutOfBlinkCors",
      "--flag-switches-end",
    ],
    permissions: [],
    locale: "en-US",
    timezoneId: "Africa/Algiers",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
    (window as any).navigator.permissions.query = (params: any) => {
      if (params.name === "notifications") return Promise.resolve({ state: "denied" });
      return Promise.resolve({ state: "prompt" });
    };
    Object.defineProperty(navigator, "connection", { get: () => ({ rtt: 50, downlink: 10 }) });
  });

  return ctx;
}

function randomDelay(min = 500, max = 2000): Promise<void> {
  return new Promise(r => setTimeout(r, Math.random() * (max - min) + min));
}

async function navigateToAppointmentBooking(page: Page): Promise<boolean> {
  try {
    await page.goto("https://visas-pt.tlscontact.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(1000, 2000);

    const loginButton = page.locator('button:has-text("Login"), a:has-text("Login")').first();
    if (await loginButton.count()) {
      await loginButton.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
      await randomDelay(1000, 2000);
    }

    await page.goto("https://visas-pt.tlscontact.com/en-us/country-selection", { waitUntil: "domcontentloaded" });
    await page.click('a:has-text("Algeria"), button:has-text("Algeria")');
    await randomDelay(1000, 2000);

    await page.goto("https://visas-pt.tlscontact.com/en-us/center-selection?country=DZ", { waitUntil: "domcontentloaded" });
    await page.click('a:has-text("Algiers"), button:has-text("Algiers")');
    await randomDelay(1000, 2000);

    await page.goto("https://visas-pt.tlscontact.com/en-us/application-list", { waitUntil: "domcontentloaded" });
    await page.click('tr:has-text("388184") a, button:has-text("Select")');
    await randomDelay(1000, 2000);

    const continueButton = page.locator('button:has-text("Continue")').first();
    if (await continueButton.count()) {
      await continueButton.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
      await randomDelay(1000, 2000);
    }

    const targetUrl = "https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt";
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await randomDelay(500, 1500);
    return true;
  } catch (err) {
    logger.error("Navigation failed", { error: String(err) });
    return false;
  }
}

async function monitorAndBook() {
  const checkId = randomUUID().slice(0, 6);
  let ctx: BrowserContext | null = null;

  // Network check – skip if no internet
  try {
    await fetch("https://1.1.1.1", { method: "HEAD", signal: AbortSignal.timeout(3000) });
  } catch {
    logger.warn(`[${checkId}] No internet – skipping run`);
    await notify(`🌐 No internet connection – task skipped`);
    return;
  }

  try {
    ctx = await createContext();
    const page = ctx.pages()[0] ?? await ctx.newPage();

    const success = await navigateToAppointmentBooking(page);
    if (!success) throw new Error("Failed to reach appointment page");

    const blocked = await page.evaluate(() => document.body.innerText.includes("You Have Been Blocked"));
    if (blocked) {
      logger.error(`[${checkId}] Blocked by Cloudflare`);
      await notify("🚫 *Blocked by TLScontact!* Manual intervention required.");
      logToCSV("BLOCKED", checkId);
      return;
    }

    const hasSlot = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.includes("Select a slot") || body.includes("appointment slots available") || !!document.querySelector(".slot-item, .available-slot");
    });

    if (!hasSlot) {
      logToCSV("NO_SLOT", checkId);
      logger.info(`[${checkId}] No slot available`);
      return;
    }

    logToCSV("SLOT_FOUND", checkId);
    await notify("🎉 *SLOT FOUND!* Attempting to book...");

    const clicked = await page.evaluate(() => {
      const slot = document.querySelector(".slot-item, .available-slot, [class*='slot']:not([class*='unavailable'])");
      if (slot) { (slot as HTMLElement).click(); return true; }
      return false;
    });

    if (!clicked) {
      const slot = page.locator('.slot-item, .available-slot, [class*="slot"]:not([class*="unavailable"])').first();
      if (await slot.count()) await slot.click();
      else throw new Error("No clickable slot found");
    }

    await randomDelay(1000, 2000);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});

    const shot = path.join(AGENT_DIR, `slot_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await sendScreenshot(shot, "✅ Appointment slot selected! Complete payment manually.");

    logToCSV("BOOKED", checkId);
    await notify("📅 *Slot selected!* Finalise payment in the browser.");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${checkId}] Monitor error`, { error: msg });
    logToCSV("ERROR", msg);
    await notify(`⚠️ Monitor error: ${msg.slice(0, 200)}`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return res.status(403).end();
  next();
});

app.post("/run", async (_req, res) => {
  res.json({ ok: true });
  monitorAndBook().catch(e => logger.error("Manual run error", e));
});
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = parseInt(process.env.CONTROL_PORT ?? "7432", 10);
app.listen(PORT, "127.0.0.1", () => logger.info(`Monitor ready on :${PORT}`));

setInterval(() => {
  monitorAndBook().catch(e => logger.error("Loop error", e));
}, 30_000);

monitorAndBook().catch(e => logger.error("Startup error", e));
SERVEREOF

echo "✅ server.ts fixed"

# Kill old processes
pkill -f "tsx src/server.ts" 2>/dev/null || true
pkill -f "api_watcher.py" 2>/dev/null || true

# Stop systemd services that might conflict
systemctl --user stop visa-agent 2>/dev/null || true
systemctl --user disable visa-agent 2>/dev/null || true
systemctl --user stop visa-api-watcher 2>/dev/null || true
systemctl --user disable visa-api-watcher 2>/dev/null || true

# Kill tmux session if exists
tmux kill-session -t visa 2>/dev/null || true

# Start fresh tmux session
tmux new -d -s visa
tmux send-keys -t visa "cd ~/visa-agent" Enter
tmux send-keys -t visa "export DISPLAY=:0" Enter
tmux send-keys -t visa "export XAUTHORITY=$HOME/.Xauthority" Enter
tmux send-keys -t visa "export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus" Enter
tmux send-keys -t visa "npx tsx src/server.ts" Enter

echo "✅ Monitor running in tmux session 'visa'"

# Update verification script to use a better network check
cat > verify-slot-system.sh << 'VERIFYEOF'
#!/bin/bash
echo "=== Slot Monitoring System Verification ==="
echo -n "1. tsx and server running? "
pgrep -f "tsx src/server.ts" > /dev/null && echo "✅" || echo "❌ (run: ./restore_and_run.sh)"
echo -n "2. api_watcher running? (optional) "
pgrep -f "api_watcher.py" > /dev/null && echo "✅" || echo "⚠️ Not needed (monitor uses internal loop)"
echo -n "3. Telegram 409 conflict? "
journalctl --user -u visa-agent -n 20 2>/dev/null | grep -q "409" && echo "⚠️ Still present" || echo "✅ Resolved"
echo -n "4. Network reachable (google)? "
curl -s -o /dev/null -w "%{http_code}" https://google.com | grep -q "200\|301\|302" && echo "✅" || echo "❌"
echo -n "5. Config file valid? "
python3 -c "import yaml; yaml.safe_load(open('config.yaml'))" 2>/dev/null && echo "✅" || echo "❌"
echo -n "6. Browser profile exists? "
[ -d "/home/samsepi0l/.config/google-chrome/tls-work" ] && echo "✅" || echo "❌"
echo "=== To see live logs: tmux attach -t visa ==="
VERIFYEOF
chmod +x verify-slot-system.sh

echo "=== All fixes applied ==="
echo "Run ./verify-slot-system.sh to check status"
echo "Attach to tmux: tmux attach -t visa"
