// ============================================================
// TLScontact Appointment Slot Monitor – NSA Edition
// ============================================================
import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import type { Page } from "playwright";
import { createBrowserContext } from "./browser.js";
import TelegramBot from "node-telegram-bot-api";

// ------------------------------------------------------------------
// Directories & Logging
// ------------------------------------------------------------------
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
  if (!existsSync(CSV_LOG)) {
    require("fs").writeFileSync(CSV_LOG, "timestamp,status,details\n");
  }
  require("fs").appendFileSync(CSV_LOG, row);
}

// ------------------------------------------------------------------
// Telegram
// ------------------------------------------------------------------
const ALLOWED_ID = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID!, 10);
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: false });

async function notify(text: string) {
  try {
    await bot.sendMessage(ALLOWED_ID, text, { parse_mode: "Markdown" });
  } catch (e) {
    logger.error("Telegram failed", { error: String(e) });
  }
}

// ------------------------------------------------------------------
// Helper: random human‑like delay
// ------------------------------------------------------------------
function randomDelay(min = 300, max = 800): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.random() * (max - min) + min));
}

// ------------------------------------------------------------------
// Navigate to the appointment booking page (full flow)
// ------------------------------------------------------------------
async function navigateToAppointmentBooking(page: Page): Promise<boolean> {
  try {
    // Step 1: Home page
    await page.goto("https://visas-pt.tlscontact.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomDelay(1000, 2000);

    // If login page appears, click login (credentials already saved in profile)
    const loginBtn = page.locator('button:has-text("Login"), a:has-text("Login")').first();
    if (await loginBtn.count()) {
      await loginBtn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
      await randomDelay(1000, 2000);
    }

    // Step 2: Country selection – Algeria
    await page.goto("https://visas-pt.tlscontact.com/en-us/country-selection", {
      waitUntil: "domcontentloaded",
    });
    await page.click('a:has-text("Algeria"), button:has-text("Algeria")');
    await randomDelay(1000, 2000);

    // Step 3: City selection – Algiers
    await page.goto("https://visas-pt.tlscontact.com/en-us/center-selection?country=DZ", {
      waitUntil: "domcontentloaded",
    });
    await page.click('a:has-text("Algiers"), button:has-text("Algiers")');
    await randomDelay(1000, 2000);

    // Step 4: Application list – select 388184
    await page.goto("https://visas-pt.tlscontact.com/en-us/application-list", {
      waitUntil: "domcontentloaded",
    });
    await page.click('tr:has-text("388184") a, button:has-text("Select")');
    await randomDelay(1000, 2000);

    // Step 5: Courier delivery step (if present)
    const continueBtn = page.locator('button:has-text("Continue")').first();
    if (await continueBtn.count()) {
      await continueBtn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
      await randomDelay(1000, 2000);
    }

    // Step 6: Appointment booking page
    const targetUrl =
      "https://visas-pt.tlscontact.com";
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await randomDelay(500, 1500);
    return true;
  } catch (err) {
    logger.error("Navigation failed", { error: String(err) });
    return false;
  }
}

// ------------------------------------------------------------------
// Main monitoring loop – checks every 5 seconds
// ------------------------------------------------------------------
async function monitorAndBook() {
  const checkId = randomUUID().slice(0, 6);
  let ctx: Awaited<ReturnType<typeof createBrowserContext>> | null = null;

  // Network pre‑check
  try {
    await fetch("https://1.1.1.1", { method: "HEAD", signal: AbortSignal.timeout(3000) });
  } catch {
    logger.warn(`[${checkId}] No internet – skipping`);
    return;
  }

  try {
    const profilePath = path.join(
      process.env.CHROME_USER_DATA ?? path.join(HOME, ".config/google-chrome"),
      process.env.CHROME_PROFILE ?? "tls-work"
    );
    ctx = await createBrowserContext(profilePath, process.env.CHROME_BIN ?? "/usr/bin/google-chrome");
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // Navigate to appointment page
    const navOk = await navigateToAppointmentBooking(page);
    if (!navOk) throw new Error("Failed to reach appointment page");

    // Check for Cloudflare block
    const blocked = await page
      .evaluate(() => document.body.innerText.includes("You Have Been Blocked"))
      .catch(() => false);
    if (blocked) {
      logger.error(`[${checkId}] Blocked by Cloudflare`);
      await notify("🚫 *Blocked by TLScontact!* Manual intervention required.");
      logToCSV("BLOCKED", checkId);
      return;
    }

    // Detect slot
    const hasSlot = await page.evaluate(() => {
      const body = document.body.innerText;
      return (
        body.includes("Select a slot") ||
        body.includes("appointment slots available") ||
        !!document.querySelector(".slot-item, .available-slot, [class*='slot']:not([class*='unavailable'])")
      );
    });

    if (!hasSlot) {
      logToCSV("NO_SLOT", checkId);
      logger.info(`[${checkId}] No slot available`);
      return;
    }

    // Slot found – click it!
    logToCSV("SLOT_FOUND", checkId);
    await notify("🎉 *SLOT FOUND!* Attempting to book...");

    const clicked = await page.evaluate(() => {
      const slot = document.querySelector(
        ".slot-item, .available-slot, [class*='slot']:not([class*='unavailable'])"
      ) as HTMLElement;
      if (slot) {
        slot.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      const slot = page
        .locator('.slot-item, .available-slot, [class*="slot"]:not([class*="unavailable"])')
        .first();
      if (await slot.count()) await slot.click();
      else throw new Error("No clickable slot found");
    }

    await randomDelay(1000, 2000);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});

    // Take screenshot and notify
    const shot = path.join(AGENT_DIR, `slot_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await notify(`✅ *Appointment slot selected!* Screenshot saved. Complete payment manually.`);

    logToCSV("BOOKED", checkId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${checkId}] Monitor error`, { error: msg });
    logToCSV("ERROR", msg);
    await notify(`⚠️ Monitor error: ${msg.slice(0, 200)}`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ------------------------------------------------------------------
// HTTP server (for manual trigger)
// ------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip))
    return res.status(403).json({ error: "Forbidden" });
  next();
});

app.post("/run", async (_req, res) => {
  res.json({ ok: true });
  monitorAndBook().catch((e) => logger.error("Manual run error", e));
});
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = parseInt(process.env.CONTROL_PORT ?? "7432", 10);
app.listen(PORT, "127.0.0.1", () => logger.info(`Monitor ready on :${PORT}`));

// ------------------------------------------------------------------
// Continuous loop – check every 5 seconds
// ------------------------------------------------------------------
setInterval(() => {
  monitorAndBook().catch((e) => logger.error("Loop error", e));
}, 5000); // <-- 5 seconds

// Run once on start
monitorAndBook().catch((e) => logger.error("Startup error", e));let isRunning = false;
const safeMonitorAndBook = async () => {
  if (isRunning) return;
  isRunning = true;
  try { await monitorAndBook(); }
  finally { isRunning = false; }
};
// Replace the existing setInterval call with:
setInterval(() => safeMonitorAndBook().catch(e => logger.error(e)), 30000);
