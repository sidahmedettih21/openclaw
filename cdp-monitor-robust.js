const { chromium } = require('playwright');
const https = require('https');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE';
const CHAT_ID = process.env.CHAT_ID || '8092143549';
const TARGET_URL = process.env.TLS_BASE_URL || 'http://localhost:8080/';
const APP_LIST_URL = 'https://visas-pt.tlscontact.com/en-us/application-list'; // fallback
const CDP_PORT = 9222;
const HOT_WINDOWS = [
  { s: 8*60+55, e: 9*60+15 },   // 08:55‑09:15 Algiers
  { s: 13*60+55, e: 14*60+15 }, // 13:55‑14:15 Algiers
];

// Telegram
function sendTelegram(text, parse_mode = '') {
  if (!TELEGRAM_TOKEN) return;
  const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { const r = JSON.parse(data); if (!r.ok) console.error('Telegram error:', r.description); }
      catch {}
    });
  });
  req.on('error', (e) => console.error('Telegram request failed:', e.message));
  req.write(payload);
  req.end();
}

// Time helpers
function nowInAlgiers() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Algiers' }));
  return d.getHours()*60 + d.getMinutes();
}
function isHotWindow() { return HOT_WINDOWS.some(w => nowInAlgiers() >= w.s && nowInAlgiers() <= w.e); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

let browser;

async function getPage() {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('No contexts');
  let pages = ctx.pages();
  if (!pages.length) pages = [await ctx.newPage()];
  return pages[0];
}

// Human‑like refresh action
async function humanRefresh(page) {
  const action = Math.random();
  if (action < 0.6) {
    console.log('[REFRESH] Soft reload');
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  } else {
    console.log('[REFRESH] Heartbeat – visiting application list');
    await page.goto(APP_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(randomDelay(800, 1500));
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }
}

// Generic click helper using text (works on both simulation and real TLS)
async function clickByText(page, text) {
  const btn = page.getByText(text, { exact: true }).first();
  if (await btn.count() > 0) {
    await btn.click();
    return true;
  }
  return false;
}

// Booking flow – text‑based selectors
async function attemptBooking(page) {
  // 1. Courier step
  if (await clickByText(page, 'Continue')) {
    console.log('[BOT] Courier Continue clicked');
    await page.waitForTimeout(randomDelay(500, 1000));
  }

  // 2. Month tab – just ensure days are visible (click a future month if needed)
  // The simulation opens April by default; real TLS may need clicking a month tab
  const monthTabs = page.locator('#sim-month-tabs button, [data-testid="btn-current-month-available"]');
  if (await monthTabs.count() > 0) {
    const current = monthTabs.filter({ hasText: /April|May|June/ }).first(); // we prefer a month with slots
    if (await current.count() > 0) {
      await current.click();
      console.log('[BOT] Month tab clicked');
      await page.waitForTimeout(randomDelay(300, 600));
    }
  }

  // 3. Click an available day (generic: any green/blue day or cell with 'available' class)
  const dayBtn = page.locator('button.available, td.available a, [class*="slot"][class*="available"]').first();
  if (await dayBtn.count() === 0) {
    console.log('[BOT] No available day visible');
    return false;
  }
  await dayBtn.click();
  console.log('[BOT] Day selected');
  await page.waitForTimeout(randomDelay(400, 800));

  // 4. Wait for time slots (appear after day click)
  const slotBtn = page.locator('.sim-slot-btn, button[data-slot], button:has-text(":")').first();
  try {
    await slotBtn.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    console.log('[BOT] Time slots did not appear');
    return false;
  }

  // 5. Click first time slot
  await slotBtn.click();
  console.log('[BOT] Time slot clicked');
  await page.waitForTimeout(randomDelay(300, 600));

  // 6. Click Book button (text-based, works everywhere)
  const bookBtn = page.getByRole('button', { name: /Book your appointment|Confirm|Submit/i }).first();
  if (await bookBtn.count() > 0 && await bookBtn.isEnabled()) {
    await bookBtn.click();
    console.log('[BOT] Booking submitted');
    await page.waitForTimeout(2000);
    const shot = path.join(__dirname, `slot_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    sendTelegram(`✅ Appointment booked! Screenshot: ${shot}`);
    return true;
  }
  console.log('[BOT] Book button not enabled');
  return false;
}

// Monitoring loop
async function monitorLoop() {
  let lastRefresh = 0;
  while (true) {
    let page;
    try { page = await getPage(); } catch { await new Promise(r => setTimeout(r, 3000)); continue; }

    // Adaptive refresh interval
    const refreshInterval = isHotWindow() ? randomDelay(5000, 6000) : randomDelay(45000, 90000);
    if (Date.now() - lastRefresh > refreshInterval) {
      await humanRefresh(page);
      lastRefresh = Date.now();
    }

    // Cloudflare block check
    const blocked = await page.evaluate(() => /you have been blocked|checking your browser/i.test(document.body.innerText)).catch(() => false);
    if (blocked) {
      sendTelegram('🚫 Cloudflare block – manual intervention required.');
      await new Promise(r => setTimeout(r, 300000));
      continue;
    }

    const success = await attemptBooking(page);
    if (success) {
      console.log('[BOT] Booking completed – waiting 30s before next cycle');
      await page.waitForTimeout(30000);
      lastRefresh = Date.now(); // reset timer after booking
    } else {
      console.log('[CHECK] No booking possible yet');
    }

    // Wait before next attempt (short during hot windows)
    const waitTime = isHotWindow() ? randomDelay(3000, 4000) : randomDelay(5000, 8000);
    await page.waitForTimeout(waitTime);
  }
}

(async () => {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    console.log('✅ Connected to Chrome.');
    let page = await getPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log(`Navigated to ${TARGET_URL}`);
    await page.addInitScript(() => { delete navigator.__proto__.webdriver; });
    sendTelegram('🟢 CDP monitor started');
    await monitorLoop();
  } catch (e) {
    sendTelegram(`❌ Crash: ${e.message}`);
    process.exit(1);
  }
})();