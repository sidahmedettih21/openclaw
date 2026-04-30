const { chromium } = require('playwright');
const { execSync } = require('child_process');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const CHAT_ID = process.env.CHAT_ID || "";
const TLS_URL = 'https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt';  // Your exact URL

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const sendTelegram = async (msg) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('Telegram error:', e.message); }
};

// Rotate user agents
const USER_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];
let uaIndex = 0;
const nextUA = () => USER_AGENTS[uaIndex++ % USER_AGENTS.length];

async function checkForSlots(page) {
  const SLOT_SELECTORS = [
    '.sim-slot-btn',           // simulation style
    '.slot-btn',               // common class
    '.available-slot',
    '[class*="slot"]:not(.disabled)',
    'button[data-time]',
  ];
  for (const sel of SLOT_SELECTORS) {
    const slots = await page.$$(sel);
    if (slots.length > 0) return slots;
  }
  return [];
}

async function bookSlot(page, slot) {
  try {
    await slot.click();
    await page.waitForTimeout(randomDelay(800, 1500));
    const confirmBtns = await page.$$('button[type="submit"], .btn-book, button:has-text("Book")');
    if (confirmBtns.length) await confirmBtns[0].click();
    return true;
  } catch(e) {
    console.error('Booking error:', e.message);
    return false;
  }
}

async function main() {
  console.log('[PROD] Starting TLScontact monitor...');
  await sendTelegram('🟢 Live monitor started. Keep this Chrome window visible.');

  const browser = await chromium.launch({
    headless: false,   // visible for manual login if needed
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({ userAgent: nextUA(), viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  console.log('[PROD] Navigating to TLScontact...');
  await page.goto(TLS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  
  console.log('[PROD] If not logged in, log in manually now. Waiting 45 seconds...');
  await page.waitForTimeout(45000);
  await sendTelegram('⏳ Login period ended. Monitoring active.');

  let checkCount = 0;
  let lastRefresh = Date.now();
  const REFRESH_INTERVAL = randomDelay(60000, 120000); // 1-2 minutes

  while (true) {
    checkCount++;
    const now = Date.now();

    if (now - lastRefresh > REFRESH_INTERVAL) {
      console.log(`[REFRESH] Reloading page (check #${checkCount})...`);
      await context.setExtraHTTPHeaders({ 'User-Agent': nextUA() });
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.error(e));
      lastRefresh = now;
    }

    const slots = await checkForSlots(page);
    if (slots.length > 0) {
      console.log(`[SLOT] FOUND! ${slots.length} slot(s) detected.`);
      await sendTelegram(`🎉 SLOT FOUND! Clicking now...`);
      const booked = await bookSlot(page, slots[0]);
      if (booked) {
        await sendTelegram('✅ Slot clicked. Complete payment in browser!');
        console.log('[BOOK] Success.');
        await page.waitForTimeout(600000);
      }
    } else if (checkCount % 20 === 0) {
      console.log(`[CHECK] #${checkCount} — no slots.`);
    }

    await page.waitForTimeout(randomDelay(1800, 2200));
  }
}

main().catch(async (e) => {
  console.error('[FATAL]', e);
  await sendTelegram(`❌ Monitor crashed: ${e.message}`);
  process.exit(1);
});
