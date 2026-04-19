import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { chromium, type BrowserContext, type Page } from "playwright";
import TelegramBot from "node-telegram-bot-api";
import { EventEmitter } from "events";
import cron from "node-cron";
import { z } from "zod";

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console({ format: format.simple() }),
    new transports.File({ filename: path.join(os.homedir(), "visa-agent", "logs", "service.log"), maxsize: 10_000_000 }),
  ],
});

const SCRYPT_N = 32768; const SCRYPT_R = 8; const SCRYPT_P = 1; const KEY_LEN = 32;
const SALT_LEN = 32; const IV_LEN = 12; const TAG_LEN = 16;
const VERSION = Buffer.from([0x56, 0x41, 0x01, 0x00]);

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export function encryptAndSave(data: any, passphrase: string, filePath: string): void {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(data), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([VERSION, salt, iv, tag, ct]);
  writeFileSync(filePath, envelope);
}

export function loadAndDecrypt(passphrase: string, filePath: string): any {
  const buf = readFileSync(filePath);
  if (!timingSafeEqual(buf.subarray(0, 4), VERSION)) throw new Error("Invalid version");
  let offset = 4;
  const salt = buf.subarray(offset, offset += SALT_LEN);
  const iv = buf.subarray(offset, offset += IV_LEN);
  const tag = buf.subarray(offset, offset += TAG_LEN);
  const ct = buf.subarray(offset);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

const ClientSchema = z.object({
  passport: z.string().regex(/^[A-Z0-9]{6,20}$/),
  fullName: z.string().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationality: z.string().min(2).max(60),
  email: z.string().email(),
  phone: z.string().regex(/^\+?[0-9\s\-.()]{7,25}$/),
  appointmentType: z.string().min(1),
});
type ClientData = z.infer<typeof ClientSchema>;

const ALLOWED_ID = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID!, 10);
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });
const commandBus = new EventEmitter();

bot.on("message", (msg) => {
  if (msg.from?.id !== ALLOWED_ID) return;
  const text = msg.text?.toLowerCase();
  if (text === "/continue") commandBus.emit("continue");
  if (text === "/abort") commandBus.emit("abort");
});

async function notify(text: string): Promise<void> {
  await bot.sendMessage(ALLOWED_ID, text, { parse_mode: "Markdown" });
}

async function sendScreenshot(imgPath: string, caption: string): Promise<void> {
  await bot.sendPhoto(ALLOWED_ID, imgPath, { caption });
}

function waitForCommand(timeoutMs = 10 * 60 * 1000): Promise<"continue" | "abort"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for /continue")), timeoutMs);
    commandBus.once("continue", () => { clearTimeout(timer); resolve("continue"); });
    commandBus.once("abort", () => { clearTimeout(timer); resolve("abort"); });
  });
}

class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailure = 0;
  constructor(private threshold = 3, private timeoutMs = 15 * 60_000) {}
  canAttempt(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN" && Date.now() - this.lastFailure >= this.timeoutMs) {
      this.state = "HALF_OPEN";
      this.successes = 0;
      return true;
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
  getState() { return this.state; }
}
const circuit = new CircuitBreaker();

const ALLOWED_DOMAINS = ["visas-pt.tlscontact.com", "tlscontact.com"];

async function createBrowserContext(cid: string): Promise<BrowserContext> {
  const profilePath = path.join(process.env.CHROME_USER_DATA!, process.env.CHROME_PROFILE!);
  const ctx = await chromium.launchPersistentContext(profilePath, {
    executablePath: process.env.CHROME_BIN,
    headless: process.env.HEADLESS === "true",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-ipc-flooding-protection",
      "--metrics-recording-only",
      "--no-first-run",
      "--password-store=basic",
      "--use-mock-keychain",
    ],
    permissions: [],
    locale: "fr-FR",
    timezoneId: "Africa/Algiers",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    try {
      const host = new URL(url).hostname;
      if (ALLOWED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) route.continue();
      else route.abort("blockedbyclient");
    } catch { route.abort("blockedbyclient"); }
  });
  await ctx.route("file://**", r => r.abort("blockedbyclient"));
  await ctx.route("data:text/html**", r => r.abort("blockedbyclient"));
  return ctx;
}

async function ensureSession(page: Page, cid: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const url = page.url();
    const hasChallenge = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return body.includes("select all images") || body.includes("sélectionner toutes") || body.includes("captcha");
    });
    const hasLogin = await page.$('input[type="password"], form[action*="login"]').then(Boolean);
    if (!hasChallenge && !hasLogin) return true;
    const state = hasChallenge ? "⚠️ Challenge detected" : "🔐 Session expired";
    await notify(`${state} at ${url}\nPlease solve manually in tls-work profile, then send /continue (or /abort).`);
    const cmd = await waitForCommand();
    if (cmd === "abort") return false;
    await page.reload({ waitUntil: "networkidle" });
  }
  await notify("Max recovery attempts reached. Aborting.");
  return false;
}

const FIELD_SPECS = [
  { label: "Passport", selectors: ['input[name="passport"]', 'input[name*="passport" i]', 'input[placeholder*="passport" i]'], type: "text", getValue: (c: ClientData) => c.passport },
  { label: "Full Name", selectors: ['input[name="fullName"]', 'input[name="full_name"]', 'input[name="name"]'], type: "text", getValue: (c) => c.fullName },
  { label: "Date of Birth", selectors: ['input[name="dateOfBirth"]', 'input[type="date"]'], type: "date", getValue: (c) => c.dateOfBirth },
  { label: "Email", selectors: ['input[type="email"]', 'input[name="email"]'], type: "email", getValue: (c) => c.email },
  { label: "Phone", selectors: ['input[type="tel"]', 'input[name="phone"]'], type: "tel", getValue: (c) => c.phone },
  { label: "Nationality", selectors: ['select[name="nationality"]', 'select[name*="national" i]'], type: "select", getValue: (c) => c.nationality },
];

async function fillField(page: Page, spec: typeof FIELD_SPECS[0], value: string): Promise<void> {
  let loc = null;
  for (const sel of spec.selectors) {
    try { loc = page.locator(sel).first(); await loc.waitFor({ state: "visible", timeout: 2000 }); break; } catch {}
  }
  if (!loc) throw new Error(`Field not found: ${spec.label}`);
  if (spec.type === "select") {
    await loc.selectOption({ label: value });
    const selected = await loc.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text ?? "");
    if (!selected.toLowerCase().includes(value.toLowerCase())) throw new Error(`Select mismatch for ${spec.label}`);
  } else {
    await loc.click({ clickCount: 3 });
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    for (const ch of value.split("")) {
      await page.keyboard.type(ch, { delay: 40 + Math.random() * 50 });
    }
    const filled = await loc.evaluate((el: HTMLInputElement) => el.value);
    if (filled.replace(/\s/g, "") !== value.replace(/\s/g, "")) {
      await loc.fill(value);
      const filled2 = await loc.evaluate((el: HTMLInputElement) => el.value);
      if (filled2.replace(/\s/g, "") !== value.replace(/\s/g, "")) throw new Error(`Verification failed for ${spec.label}`);
    }
  }
}

async function runTask(cid: string): Promise<void> {
  let ctx: BrowserContext | null = null;
  try {
    ctx = await createBrowserContext(cid);
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const targetUrl = `${process.env.TLS_BASE_URL}/appointments/check`;
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
    const sessionOk = await ensureSession(page, cid);
    if (!sessionOk) throw new Error("Session guard failed");
    const clientData = loadAndDecrypt(process.env.PASSPHRASE!, path.join(os.homedir(), "visa_data", "client.enc")) as ClientData;
    for (const spec of FIELD_SPECS) {
      const val = spec.getValue(clientData);
      if (val) await fillField(page, spec, val);
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
    }
    const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), submitBtn.click()]);
    const postOk = await ensureSession(page, cid);
    if (!postOk) throw new Error("Challenge after submit");
    const screenshotPath = path.join(os.homedir(), "visa-agent", "screenshots", `conf_${cid}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await sendScreenshot(screenshotPath, `✅ Form submitted successfully (${cid})`);
    circuit.recordSuccess();
  } catch (err) {
    circuit.recordFailure();
    const msg = err instanceof Error ? err.message : String(err);
    await notify(`🚨 Task failed [${cid}]: ${msg}`);
    throw err;
  } finally {
    if (ctx) await ctx.close();
  }
}

const app = express();
app.use(express.json());
app.post("/run", async (_req, res) => {
  const cid = randomUUID().slice(0, 8);
  if (!circuit.canAttempt()) {
    res.json({ ok: false, reason: "circuit open" });
    return;
  }
  res.json({ ok: true, cid });
  runTask(cid).catch(err => logger.error("Unhandled task error", err));
});
app.get("/health", (_req, res) => res.json({ circuit: circuit.getState() }));
app.listen(parseInt(process.env.CONTROL_PORT!), "127.0.0.1", () => logger.info("Service ready"));

const minDelay = parseInt(process.env.MIN_DELAY_MINUTES || "5");
const maxDelay = parseInt(process.env.MAX_DELAY_MINUTES || "25");
function scheduleNext() {
  const delayMinutes = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
  const nextRun = new Date(Date.now() + delayMinutes * 60000);
  logger.info(`Next scheduled run at ${nextRun.toISOString()} (in ${delayMinutes} minutes)`);
  setTimeout(() => {
    runTask(randomUUID().slice(0, 8)).catch(e => logger.error(e));
    scheduleNext();
  }, delayMinutes * 60000);
}
scheduleNext();
cron.schedule("0 9 * * 1-5", () => runTask(randomUUID().slice(0, 8)), { timezone: "Africa/Algiers" });
