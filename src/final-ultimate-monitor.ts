// final-ultimate-monitor.ts – hardened, self-contained, no bloat
import "dotenv/config";
import { createLogger, format, transports } from "winston";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import type { Page, BrowserContext } from "playwright";
import { createBrowserContext } from "./browser"; // ensure browser.ts is in same directory
import TelegramBot from "node-telegram-bot-api";

const HOME = os.homedir();
const DIR = path.join(HOME, "visa-agent");
const SHOTS = path.join(DIR, "screenshots");
mkdirSync(SHOTS, { recursive: true });
const LOG = path.join(DIR, "monitor.log");
const CSV = path.join(DIR, "slot_checks.csv");

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console({ format: format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`) }),
    new transports.File({ filename: LOG, maxsize: 10_000_000, maxFiles: 2 }),
  ],
});

function csvLog(status: string, det = "") { appendFileSync(CSV, `${new Date().toISOString()},${status},${det}\n`); }

// Telegram – optional
const ALLOWED = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID ?? "0", 10);
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN ?? "", { polling: false });
async function notify(msg: string, shot?: string) {
  if (!ALLOWED || !process.env.TELEGRAM_TOKEN) return;
  if (shot && existsSync(shot)) await bot.sendPhoto(ALLOWED, shot, { caption: msg, parse_mode: "Markdown" });
  else await bot.sendMessage(ALLOWED, msg, { parse_mode: "Markdown" });
}

// Target URLs – override TLS_BASE_URL in .env for simulation
const BASE = process.env.TLS_BASE_URL || "https://visas-pt.tlscontact.com";
const TARGET  = `${BASE}/en-us/388184/workflow/appointment-booking?location=dzALG2pt`;
const LOGIN   = `${BASE}/en-us/login`;
const APP_LIST = `${BASE}/en-us/application-list`;

// Configuration
const CFG = {
  HOT_INTERVAL: 5_000, COLD_INTERVAL: 60_000,
  HEARTBEAT_MS: 7 * 60_000, SESSION_MAX_MS: 14 * 60_000,
  HOT_WINDOWS: [{ s: 8*60+55, e: 9*60+15 }, { s: 13*60+55, e: 14*60+15 }],
  TZ: "Africa/Algiers",
  BREAKER: 3, BREAKER_BACKOFF: 60, FATAL_BACKOFF: 300,
};

// Helper functions
function algTime() { return new Date(new Date().toLocaleString("en-US", { timeZone: CFG.TZ })); }
function isHot(): boolean {
  const d = algTime(); const m = d.getHours()*60+d.getMinutes();
  return CFG.HOT_WINDOWS.some(w => m >= w.s && m <= w.e);
}
function interval() { return isHot() ? CFG.HOT_INTERVAL : CFG.COLD_INTERVAL; }
function delay(min: number, max: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.random() * (max - min) + min));
}

// Global state
const st = {
  ctx: null as BrowserContext|null, page: null as Page|null,
  running: false, lastHb: 0, lastSession: 0, errors: 0, circuitUntil: 0, found: false, total: 0,
};
function locked() { if (st.running) return true; st.running = true; return false; }
function unlock() { st.running = false; }
function circuitOpen() { return Date.now() < st.circuitUntil; }
function trip(s: number) { st.circuitUntil = Date.now()+s*1000; logger.warn(`Circuit tripped for ${s}s`); }

// Browser management
async function ensureBrowser(): Promise<{ctx:BrowserContext, page:Page}> {
  if (st.ctx && st.page) {
    const alive = await st.page.evaluate(()=>true).catch(()=>false);
    if (alive) return {ctx:st.ctx, page:st.page};
  }
  await shutdown();
  const ctx = await createBrowserContext(
    path.join(process.env.CHROME_USER_DATA??path.join(HOME,".config/google-chrome"), process.env.CHROME_PROFILE??"tls-work"),
    process.env.CHROME_BIN??"/usr/bin/google-chrome"
  );
  const page = ctx.pages()[0]??await ctx.newPage();
  st.ctx = ctx; st.page = page; st.lastSession = Date.now();
  return {ctx, page};
}
async function shutdown() {
  if (st.ctx) { await st.ctx.close().catch(()=>{}); st.ctx = null; st.page = null; }
}

// Session & navigation
async function sessionAlive(p: Page): Promise<boolean> {
  try {
    const u = p.url(); if (u.includes("/login")) return false;
    const txt = await p.evaluate(()=>document.body?.innerText??"");
    if (/session expired|timed out|please log in/i.test(txt)) return false;
    // VERIFY: Pre: page loaded → Post: true if anti-forgery token exists
    return await p.locator('input[name="__RequestVerificationToken"]').count() > 0;
  } catch { return false; }
}
async function login(p: Page) {
  await p.goto(LOGIN, { waitUntil:"domcontentloaded", timeout:30000 });
  await delay(1500,2500);
  if (!p.url().includes("/login")) return true;
  await p.locator('button:has-text("Login"), button[type="submit"]').first().click();
  await p.waitForLoadState("networkidle", { timeout:15000 }).catch(()=>{});
  await delay(1000,2000);
  if (await sessionAlive(p)) { st.lastSession = Date.now(); return true; }
  return false;
}
async function navigate(p: Page) {
  await p.goto(TARGET, { waitUntil:"domcontentloaded", timeout:30000 });
  await p.waitForLoadState("networkidle", { timeout:10000 }).catch(()=>{});
  if (!await sessionAlive(p)) { if (!await login(p)) return false; await p.goto(TARGET, { waitUntil:"domcontentloaded", timeout:30000 }); }
  // handle courier step
  const cont = p.locator('button:has-text("Continue"), button:has-text("Confirm")').first();
  if (await cont.count()) { await cont.click(); await p.waitForLoadState("networkidle", { timeout:10000 }).catch(()=>{}); await delay(500,1000); }
  return true;
}
async function heartbeat(p: Page) {
  await p.goto(APP_LIST, { waitUntil:"domcontentloaded", timeout:20000 });
  await delay(500,1000);
  if (!await sessionAlive(p)) return false;
  await p.goto(TARGET, { waitUntil:"domcontentloaded", timeout:20000 });
  st.lastHb = Date.now();
  return true;
}

// Slot detection & booking
async function detect(p: Page): Promise<boolean> {
  const has = await p.evaluate(()=>{
    const t=document.body.innerText.toLowerCase();
    return (t.includes("select a slot")||t.includes("appointment slots available")) && !t.includes("no slots available") && !t.includes("no appointment slots");
  });
  if (!has) return false;
  // Confirm at least one clickable element exists
  return await p.evaluate(()=>!!document.querySelector('.slot-item:not(.unavailable), .available-slot, button[data-slot], td.available a'));
}
async function detectRetry(p: Page) {
  for (let i=0;i<2;i++) {
    if (await detect(p)) return true;
    await delay(700,900);
  }
  return false;
}
async function book(p: Page): Promise<boolean> {
  // Click first available slot
  const clicked = await p.evaluate(()=>{
    const selectors = ['.slot-item:not(.unavailable)','.available-slot','button[data-slot]','td.available a'];
    for (const s of selectors) {
      const el = document.querySelector(s) as HTMLElement;
      if (el) { el.click(); return true; }
    }
    return false;
  });
  if (!clicked) return false;
  await p.waitForLoadState("networkidle", { timeout:10000 }).catch(()=>{});
  // Wait for anti-forgery token before confirming
  await p.waitForSelector('input[name="__RequestVerificationToken"]', { timeout:8000 }).catch(()=>{});
  await p.locator('button:has-text("Book your appointment"), button:has-text("Confirm"), button[type="submit"]').first().click();
  await p.waitForLoadState("networkidle", { timeout:10000 }).catch(()=>{});
  const shot = path.join(SHOTS, `slot_${Date.now()}.png`);
  await p.screenshot({ path: shot, fullPage: true });
  await notify(`🎉 Slot booked! Screenshot: ${shot}`, shot);
  csvLog("BOOKED", shot);
  return true;
}

// Main cycle – atomic, mutex-protected
async function cycle() {
  if (locked()) return;
  if (circuitOpen() || st.found) { unlock(); return; }
  try {
    if (!await fetch("https://1.1.1.1", { method:"HEAD", signal:AbortSignal.timeout(3000) }).then(()=>true).catch(()=>false)) { csvLog("NO_INTERNET"); unlock(); return; }
    const { page } = await ensureBrowser();
    if (Date.now() - st.lastSession > CFG.SESSION_MAX_MS) { if (!await login(page)) throw new Error("relogin fail"); }
    if (Date.now() - st.lastHb > CFG.HEARTBEAT_MS) { if (!await heartbeat(page)) { if (!await login(page)) throw new Error("hb relogin fail"); } }
    if (!await navigate(page)) throw new Error("navigation fail");
    const blocked = await page.evaluate(()=>/you have been blocked|checking your browser|ddos/i.test(document.body.innerText));
    if (blocked) { trip(CFG.FATAL_BACKOFF); csvLog("BLOCKED"); unlock(); return; }
    if (!await detectRetry(page)) { csvLog("NO_SLOT"); st.errors=0; unlock(); return; }
    csvLog("SLOT_FOUND");
    await notify("🎉 Slot found! Booking...");
    if (!await book(page)) throw new Error("booking fail");
    st.errors = 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(msg);
    st.errors++;
    if (st.errors >= CFG.BREAKER) trip(CFG.BREAKER_BACKOFF);
    if (st.errors >= 10) { trip(CFG.FATAL_BACKOFF); await shutdown(); }
  } finally { unlock(); }
}

// Scheduler
function schedule() {
  setTimeout(async ()=>{
    await cycle();
    schedule();
  }, interval());
}

// Start
(async ()=>{
  logger.info("OpenClaw Ultimate running");
  await notify("🟢 Monitor started");
  await cycle();
  schedule();
})();