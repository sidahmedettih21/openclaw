import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import {
  scryptSync, randomBytes, createCipheriv,
  createDecipheriv, timingSafeEqual
} from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { lookup } from "dns/promises";
import path from "path";
import os from "os";
import { chromium, type BrowserContext, type Page } from "playwright";
import TelegramBot from "node-telegram-bot-api";
import { EventEmitter } from "events";
import cron from "node-cron";
import { z } from "zod";

const HOME        = os.homedir();
const AGENT_DIR   = path.join(HOME, "visa-agent");
const VISADATA    = path.join(HOME, "visa_data");
const SCREENSHOTS = path.join(AGENT_DIR, "screenshots");
const LOGS_DIR    = path.join(AGENT_DIR, "logs");
for (const d of [SCREENSHOTS, LOGS_DIR, VISADATA]) mkdirSync(d, { recursive: true });

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console({ format: format.simple() }),
    new transports.File({
      filename: path.join(LOGS_DIR, "service.log"),
      maxsize: 10_000_000, maxFiles: 5,
    }),
  ],
});

// ── Crypto ─────────────────────────────────────────────────────────
const SCRYPT_N = 16384; const SCRYPT_R = 8; const SCRYPT_P = 1;
const KEY_LEN = 32; const SALT_LEN = 32; const IV_LEN = 12; const TAG_LEN = 16;
const VERSION = Buffer.from([0x56, 0x41, 0x01, 0x00]);

function deriveKey(p: string, s: Buffer): Buffer {
  return scryptSync(p, s, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}
export function encryptAndSave(data: unknown, passphrase: string, filePath: string): void {
  const salt = randomBytes(SALT_LEN); const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const plain = Buffer.from(JSON.stringify(data), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  writeFileSync(filePath, Buffer.concat([VERSION, salt, iv, cipher.getAuthTag(), ct]));
}
export function loadAndDecrypt(passphrase: string, filePath: string): unknown {
  const buf = readFileSync(filePath);
  if (!timingSafeEqual(buf.subarray(0, 4), VERSION)) throw new Error("Invalid version");
  let o = 4;
  const salt = buf.subarray(o, o += SALT_LEN); const iv  = buf.subarray(o, o += IV_LEN);
  const tag  = buf.subarray(o, o += TAG_LEN);  const ct   = buf.subarray(o);
  const dec  = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  dec.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dec.update(ct), dec.final()]).toString("utf8"));
}

const ClientSchema = z.object({
  passport:        z.string().min(6).max(20),
  fullName:        z.string().min(2).max(120),
  dateOfBirth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationality:     z.string().min(2).max(60),
  email:           z.string().email(),
  phone:           z.string().regex(/^\+?[0-9\s\-.()]{7,25}$/),
  appointmentType: z.string().min(1),
});
type ClientData = z.infer<typeof ClientSchema>;

// ── Telegram ───────────────────────────────────────────────────────
const ALLOWED_ID = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID!, 10);
const bot        = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: false });
const commandBus = new EventEmitter();

async function notify(text: string, cid?: string): Promise<void> {
  try {
    await bot.sendMessage(
      ALLOWED_ID,
      (cid ? `\`[${cid}]\` ` : "") + text,
      { parse_mode: "Markdown" }
    );
  } catch (e) { logger.error("Telegram failed", { error: String(e) }); }
}
async function sendScreenshot(p: string, caption: string): Promise<void> {
  try { await bot.sendPhoto(ALLOWED_ID, p, { caption }); }
  catch (e) { logger.error("Photo failed", { error: String(e) }); }
}
function waitForCommand(ms = 10 * 60 * 1000): Promise<"continue" | "abort"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      commandBus.removeAllListeners("continue");
      commandBus.removeAllListeners("abort");
      reject(new Error("Timeout"));
    }, ms);
    commandBus.once("continue", () => { clearTimeout(t); resolve("continue"); });
    commandBus.once("abort",    () => { clearTimeout(t); resolve("abort");    });
  });
}

// ── Circuit breaker ────────────────────────────────────────────────
class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures = 0; private successes = 0; private lastFailure = 0;
  private threshold: number; private timeoutMs: number;
  constructor(threshold = 3, timeoutMs = 15 * 60_000) {
    this.threshold = threshold; this.timeoutMs = timeoutMs;
  }
  canAttempt(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN" && Date.now() - this.lastFailure >= this.timeoutMs) {
      this.state = "HALF_OPEN"; this.successes = 0; return true;
    }
    return this.state === "HALF_OPEN";
  }
  recordSuccess(): void {
    this.failures = 0;
    if (this.state === "HALF_OPEN" && ++this.successes >= 1) this.state = "CLOSED";
  }
  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.state === "HALF_OPEN" || this.failures >= this.threshold) this.state = "OPEN";
  }
  reset(): void   { this.state = "CLOSED"; this.failures = 0; }
  getState()      { return this.state; }
  toJSON()        { return { state: this.state, failures: this.failures }; }
}
const circuit = new CircuitBreaker();

// ── Browser ────────────────────────────────────────────────────────
// Route interception REMOVED — it was blocking Chrome's internal
// connectivity probe before Playwright's handler was registered,
// causing ERR_INTERNET_DISCONNECTED on every page.goto().
// Navigation is restricted by code: only one hardcoded URL is visited.
async function createContext(cid: string): Promise<BrowserContext> {
  const profilePath = path.join(
    process.env.CHROME_USER_DATA ?? path.join(HOME, ".config/google-chrome"),
    process.env.CHROME_PROFILE   ?? "tls-work"
  );
  logger.info(`Launching browser [${cid}]`, { profilePath });

  const ctx = await chromium.launchPersistentContext(profilePath, {
    executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
    headless: false,        // Xvfb :99 provides display — headed is fine
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--use-mock-keychain",
      "--window-size=1280,800",
      "--lang=fr-FR",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    permissions: [],
    locale:      "fr-FR",
    timezoneId:  "Africa/Algiers",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["fr-FR","fr","en-US","en"] });
    Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });

  // Only block file:// and data:// — do NOT block any http/https
  await ctx.route("file://**",        r => r.abort("blockedbyclient"));
  await ctx.route("data:text/html**", r => r.abort("blockedbyclient"));

  logger.info(`Browser ready [${cid}]`);
  return ctx;
}

// ── Session guard ──────────────────────────────────────────────────
async function ensureSession(page: Page, cid: string): Promise<boolean> {
  for (let i = 1; i <= 3; i++) {
    const url = page.url();
    const state = await page.evaluate(() => {
      const t = (document.body?.innerText ?? "").toLowerCase();
      return {
        challenge: t.includes("captcha") ||
                   t.includes("verify you are human") ||
                   t.includes("select all") ||
                   !!document.querySelector('[class*="captcha" i], iframe[src*="recaptcha"]'),
        login: !!document.querySelector('input[type="password"], form[action*="login"]'),
      };
    }).catch(() => ({ challenge: false, login: false }));

    if (!state.challenge && !state.login) return true;

    const label  = state.challenge ? "⚠️ Challenge" : "🔐 Session expired";
    const action = state.challenge ? "solve the challenge" : "log in again";
    await notify(
      `${label} \`[${cid}]\` attempt ${i}/3\n` +
      `URL: \`${url}\`\n\nPlease ${action} in Chrome, then:\n▶️ /continue  🛑 /abort`,
      cid
    );
    let cmd: "continue" | "abort";
    try   { cmd = await waitForCommand(); }
    catch { await notify(`⏱️ Timeout [${cid}]`, cid); return false; }
    if (cmd === "abort") return false;
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  return false;
}

// ── Form engine ────────────────────────────────────────────────────
interface FieldSpec {
  label: string; selectors: string[]; type: string;
  getValue: (c: ClientData) => string;
}
const FIELD_SPECS: FieldSpec[] = [
  {
    label: "Passport",
    selectors: ['input[name="passport"]','input[name*="passport" i]',
                'input[placeholder*="passport" i]','input[id*="passport" i]'],
    type: "text", getValue: c => c.passport,
  },
  {
    label: "Full Name",
    selectors: ['input[name="fullName"]','input[name="full_name"]',
                'input[name="name"]','input[placeholder*="name" i]'],
    type: "text", getValue: c => c.fullName,
  },
  {
    label: "Date of Birth",
    selectors: ['input[name="dateOfBirth"]','input[name="dob"]',
                'input[type="date"]','input[placeholder*="birth" i]'],
    type: "date", getValue: c => c.dateOfBirth,
  },
  {
    label: "Email",
    selectors: ['input[type="email"]','input[name="email"]','input[placeholder*="email" i]'],
    type: "email", getValue: c => c.email,
  },
  {
    label: "Phone",
    selectors: ['input[type="tel"]','input[name="phone"]','input[name*="phone" i]'],
    type: "tel", getValue: c => c.phone,
  },
  {
    label: "Nationality",
    selectors: ['select[name="nationality"]','select[name*="national" i]','select[id*="national" i]'],
    type: "select", getValue: c => c.nationality,
  },
];

async function fillField(page: Page, spec: FieldSpec, value: string): Promise<void> {
  for (const sel of spec.selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: 3000 });
      if (spec.type === "select") {
        try { await loc.selectOption({ label: value }); }
        catch { await loc.selectOption({ value }); }
      } else {
        await loc.click({ clickCount: 3 });
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Delete");
        await loc.type(value, { delay: 45 + Math.random() * 55 });
        let got = await loc.evaluate((e: HTMLInputElement) => e.value);
        if (got.replace(/\s/g, "") !== value.replace(/\s/g, "")) {
          await loc.fill(value);
          got = await loc.evaluate((e: HTMLInputElement) => e.value);
          if (got.replace(/\s/g, "") !== value.replace(/\s/g, ""))
            throw new Error(`verify failed: "${got}"`);
        }
      }
      logger.info(`Filled: ${spec.label}`);
      return;
    } catch { continue; }
  }
  throw new Error(`All selectors failed: ${spec.label}`);
}

// ── Task ───────────────────────────────────────────────────────────
async function runTask(cid: string): Promise<void> {
  const encPath = path.join(VISADATA, "client.enc");
  if (!existsSync(encPath)) {
    logger.warn(`[${cid}] client.enc missing — skipping`);
    await notify(`⏭️ No client data yet \`[${cid}]\``, cid);
    return;
  }
  try { await lookup("visas-pt.tlscontact.com"); }
  catch {
    logger.warn(`[${cid}] DNS failed — no internet`);
    await notify(`🌐 No internet \`[${cid}]\` — skipping`, cid);
    return;
  }

  let ctx: BrowserContext | null = null;
  logger.info(`Task started [${cid}]`);

  try {
    ctx = await createContext(cid);
    const page = ctx.pages()[0] ?? await ctx.newPage();

    await page.goto(
      `${process.env.TLS_BASE_URL}/appointments/check`,
      { waitUntil: "domcontentloaded", timeout: 45_000 }
    );
    await page.waitForLoadState("networkidle", { timeout: 30_000 })
      .catch(() => logger.warn(`[${cid}] networkidle timeout — continuing`));

    if (!await ensureSession(page, cid)) throw new Error("Session guard failed");

    const client = ClientSchema.parse(
      loadAndDecrypt(process.env.PASSPHRASE!, encPath)
    );

    for (const spec of FIELD_SPECS) {
      const val = spec.getValue(client);
      if (!val) continue;
      await fillField(page, spec, val);
      await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
    }

    const submit = page.locator(
      'button[type="submit"], input[type="submit"], ' +
      '[role="button"]:has-text("Soumettre"), [role="button"]:has-text("Submit")'
    ).first();
    await submit.waitFor({ state: "visible", timeout: 8000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => {}),
      submit.click(),
    ]);

    if (!await ensureSession(page, cid)) throw new Error("Challenge after submit");

    const shot = path.join(SCREENSHOTS, `conf_${cid}_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await sendScreenshot(shot, `✅ Done [${cid}] – ${new Date().toLocaleString("fr-DZ")}`);
    circuit.recordSuccess();
    logger.info(`Task done [${cid}]`);
  } catch (err: unknown) {
    circuit.recordFailure();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Task failed [${cid}]`, { error: msg });
    await notify(`🚨 Failed \`[${cid}]\`\n\`\`\`\n${msg.slice(0, 500)}\n\`\`\``, cid);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ── HTTP ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
    res.status(403).end(); return;
  }
  next();
});

app.post("/run", (_q, res) => {
  const cid = randomUUID().slice(0, 8);
  if (!circuit.canAttempt()) {
    res.json({ ok: false, reason: `Circuit ${circuit.getState()}` }); return;
  }
  res.json({ ok: true, cid });
  runTask(cid).catch(e => logger.error("Unhandled", e));
});
app.post("/continue", (_q, res) => { commandBus.emit("continue"); res.json({ ok: true }); });
app.post("/abort",    (_q, res) => { commandBus.emit("abort");    res.json({ ok: true }); });
app.post("/reset",    (_q, res) => { circuit.reset(); res.json({ ok: true, circuit: circuit.toJSON() }); });
app.get("/health",    (_q, res) => res.json({ ok: true, circuit: circuit.toJSON(), uptime: process.uptime() }));

const PORT = parseInt(process.env.CONTROL_PORT ?? "7432", 10);
app.listen(PORT, "127.0.0.1", () => logger.info(`Service ready on :${PORT}`));

// ── Scheduler ──────────────────────────────────────────────────────
function scheduleNext(): void {
  const min   = parseInt(process.env.MIN_DELAY_MINUTES ?? "5");
  const max   = parseInt(process.env.MAX_DELAY_MINUTES ?? "25");
  const delay = Math.floor(Math.random() * (max - min + 1) + min);
  logger.info(`Next run in ${delay}m`);
  setTimeout(() => {
    if (circuit.canAttempt()) runTask(randomUUID().slice(0, 8)).catch(e => logger.error(e));
    scheduleNext();
  }, delay * 60_000);
}
scheduleNext();

cron.schedule("0 9 * * 1-5", () => {
  if (circuit.canAttempt()) runTask(randomUUID().slice(0, 8));
}, { timezone: "Africa/Algiers" });

process.on("unhandledRejection", async reason => {
  const m = reason instanceof Error ? reason.message : String(reason);
  logger.error("Unhandled rejection", { error: m });
  await notify(`🛑 Crash: \`${m.slice(0, 300)}\``).catch(() => {});
});
