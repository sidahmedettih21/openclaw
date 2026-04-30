const { chromium } = require('playwright');
const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

function sendTelegram(text) {
  if (!TELEGRAM_TOKEN) return;
  const data = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  const req = https.request(options);
  req.write(data);
  req.end();
}

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const REFRESH_INTERVAL = randomDelay(60000, 120000); // 60-120 seconds
const CHECK_INTERVAL = 2000; // 2 seconds

const PROFILE_PATH = '/home/samsepi0l/.config/google-chrome/tls-work';
const TLS_URL = 'https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt';
const SLOT_SELECTORS = [
  '.sim-slot-btn',
  '.slot-btn',
  '.available-slot',
  '[class*="slot"]:not(.disabled)',
  'button[data-time]',
];

async function findSlot(page) {
  for (const sel of SLOT_SELECTORS) {
    const slot = await page.$(sel);
    if (slot) return slot;
  }
  return null;
}

async function main() {
  console.log('[MONITOR] Starting standalone monitor...');
  sendTelegram('🟢 Standalone monitor started. Using persistent context.');

  // Launch Chrome with your existing profile (preserves login and cookies)
  const browser = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,          // visible so you can intervene if needed
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(TLS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('[MONITOR] Page loaded. Monitoring active.');

  let lastRefresh = Date.now();
  let checkCount = 0;

  while (true) {
    const now = Date.now();
    if (now - lastRefresh > REFRESH_INTERVAL) {
      console.log('[REFRESH] Reloading page...');
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.error(e));
      lastRefresh = now;
    }

    const slot = await findSlot(page);
    checkCount++;
    if (slot) {
      console.log(`[SLOT] Found at check #${checkCount}! Clicking...`);
      sendTelegram('🎉 SLOT FOUND! Clicking now...');
      try {
        await slot.click();
        await page.waitForTimeout(1000);
        // Try to click the book button
        const bookSelectors = ['button[type="submit"]', '.btn-book', 'button:has-text("Book")'];
        for (const sel of bookSelectors) {
          const bookBtn = await page.$(sel);
          if (bookBtn) {
            await bookBtn.click();
            break;
          }
        }
        sendTelegram('✅ Appointment booked! Complete payment manually.');
        console.log('[BOOK] Success.');
        await page.waitForTimeout(600000); // wait 10 min after booking
      } catch(e) {
        console.error('[CLICK ERROR]', e.message);
        sendTelegram(`⚠️ Click error: ${e.message.slice(0, 100)}`);
      }
    } else if (checkCount % 20 === 0) {
      console.log(`[CHECK] #${checkCount} — no slots.`);
    }

    await page.waitForTimeout(CHECK_INTERVAL);
  }
}

main().catch(async (err) => {
  console.error('[FATAL]', err);
  sendTelegram(`❌ Monitor crashed: ${err.message}`);
  process.exit(1);
});
