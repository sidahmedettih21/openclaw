const { chromium } = require('playwright');
const https = require('https');

// Get Telegram credentials from environment variables (NEVER hardcode)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

function sendTelegram(text) {
  if (!TELEGRAM_TOKEN) return;
  const data = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
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
let browser = null;
let reconnecting = false;

async function getPage() {
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No browser contexts');
  const pages = contexts[0].pages();
  if (!pages.length) throw new Error('No pages');
  return pages[0];
}

async function connect() {
  console.log('[CDP] Connecting to Chrome on port 9222...');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await getPage();
  console.log('[CDP] Connected.', await page.title());
  return page;
}

async function monitor() {
  console.log('[MONITOR] Starting...');
  let page;
  try {
    page = await connect();
  } catch (err) {
    console.error('[MONITOR] Cannot connect. Start Chrome with --remote-debugging-port=9222');
    sendTelegram('❌ Cannot connect to Chrome. Please start Chrome with remote debugging and log into TLScontact.');
    process.exit(1);
  }

  let lastRefresh = Date.now();
  const REFRESH_INTERVAL = randomDelay(60000, 120000);
  let checkCount = 0;

  while (true) {
    try {
      const now = Date.now();
      if (now - lastRefresh > REFRESH_INTERVAL) {
        console.log('[REFRESH] Reloading page...');
        await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.warn(e));
        lastRefresh = now;
      }

      const text = await page.evaluate(() => document.body.innerText);
      const hasSlot = text.includes('Select a slot') && !text.includes('No slots are currently available');
      checkCount++;

      if (hasSlot) {
        console.log(`[SLOT] FOUND at check #${checkCount}`);
        sendTelegram('🎉 *SLOT FOUND!* Attempting to click...');
        // Try multiple methods to click
        let clicked = false;
        const selectors = ['.sim-slot-btn', '.slot-btn', '.available-slot', '[class*="slot"]:not(.disabled)', 'button[data-time]'];
        for (const sel of selectors) {
          const el = await page.$(sel);
          if (el) { await el.click(); clicked = true; break; }
        }
        if (!clicked) {
          const btns = await page.$$('button');
          for (const btn of btns) {
            const txt = await btn.textContent();
            if (txt && txt.match(/\d{2}:\d{2}/)) {
              await btn.click(); clicked = true; break;
            }
          }
        }
        if (clicked) {
          await page.waitForTimeout(1000);
          const bookSelectors = ['button[type="submit"]', '.btn-book', 'button:has-text("Book")'];
          for (const sel of bookSelectors) {
            const btn = await page.$(sel);
            if (btn) { await btn.click(); break; }
          }
          sendTelegram('✅ *Appointment booked!* Complete payment manually.');
          await page.waitForTimeout(30000);
        } else {
          sendTelegram('⚠️ Could not click slot – click manually now.');
        }
      } else if (checkCount % 20 === 0) {
        console.log(`[CHECK] #${checkCount} – no slots.`);
      }

      await page.waitForTimeout(2000);
    } catch (err) {
      console.error('[ERROR]', err.message);
      if (err.message.includes('closed') || err.message.includes('detached') || err.message.includes('Target')) {
        console.log('[RECONNECT] Lost page, reconnecting...');
        if (!reconnecting) {
          reconnecting = true;
          try {
            page = await connect();
            reconnecting = false;
          } catch (e) {
            console.error('[RECONNECT] Failed:', e.message);
            await new Promise(r => setTimeout(r, 5000));
            reconnecting = false;
          }
        }
      }
    }
  }
}

monitor().catch(async (err) => {
  console.error('[FATAL]', err);
  sendTelegram(`❌ Monitor crashed: ${err.message}`);
  process.exit(1);
});
