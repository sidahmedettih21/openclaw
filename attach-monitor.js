const { chromium } = require('playwright');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

const sendTelegram = async (msg) => {
  if (!TELEGRAM_TOKEN) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('Telegram error:', e.message); }
};

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

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

async function monitor() {
  console.log('[MONITOR] Connecting to existing Chrome on port 9222...');
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (err) {
    console.error('[FATAL] Could not connect to Chrome. Is it running with --remote-debugging-port=9222?');
    process.exit(1);
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    console.error('[FATAL] No browser contexts found.');
    process.exit(1);
  }
  let page = contexts[0].pages()[0];
  if (!page) {
    console.error('[FATAL] No pages found in browser context.');
    process.exit(1);
  }

  console.log(`[MONITOR] Attached to page: ${page.url()}`);
  await sendTelegram('🟢 Monitor attached. Will check for slots every 2s and refresh periodically.');

  let lastRefresh = Date.now();
  const REFRESH_INTERVAL = randomDelay(60000, 120000); // 1-2 minutes
  let checkCount = 0;

  while (true) {
    checkCount++;
    const now = Date.now();

    // Refresh page on schedule
    if (now - lastRefresh > REFRESH_INTERVAL) {
      console.log(`[REFRESH] Reloading page (check #${checkCount})...`);
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.error('Reload error:', e.message));
      lastRefresh = now;
    }

    // Check for slot
    const slot = await findSlot(page);
    if (slot) {
      console.log(`[SLOT] 🎉 FOUND! Clicking...`);
      await sendTelegram('🎉 SLOT FOUND! Clicking now...');
      try {
        await slot.click();
        await page.waitForTimeout(randomDelay(800, 1500));
        const bookBtn = await page.$('button[type="submit"], .btn-book, button:has-text("Book")');
        if (bookBtn) {
          await bookBtn.click();
          await sendTelegram('✅ Slot clicked + booking confirmed. Complete payment in browser.');
          console.log('[BOOK] Success.');
        } else {
          await sendTelegram('⚠️ Slot clicked but no book button found.');
        }
        // Stop monitoring after booking (optional)
        break;
      } catch (err) {
        console.error('[CLICK ERROR]', err.message);
        await sendTelegram(`❌ Click failed: ${err.message.slice(0, 100)}`);
      }
    } else if (checkCount % 20 === 0) {
      console.log(`[CHECK] #${checkCount} — no slots.`);
    }

    await page.waitForTimeout(randomDelay(1800, 2200));
  }
}

monitor().catch(async (err) => {
  console.error('[FATAL]', err);
  await sendTelegram(`❌ Monitor crashed: ${err.message}`);
  process.exit(1);
});
