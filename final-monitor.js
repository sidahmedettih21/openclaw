const { chromium } = require('playwright');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

function sendTelegram(text) {
  if (!TELEGRAM_TOKEN) return;
  const https = require('https');
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
let browser = null;

async function getPage() {
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No contexts');
  const pages = contexts[0].pages();
  if (!pages.length) throw new Error('No pages');
  return pages[0];
}

async function connect() {
  console.log('[MONITOR] Connecting to Chrome on port 9222...');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  console.log('[MONITOR] Connected.');
  return await getPage();
}

let page;
(async () => {
  try {
    page = await connect();
  } catch (err) {
    console.error('[MONITOR] Cannot connect. Start Chrome with --remote-debugging-port=9222');
    sendTelegram('❌ Cannot connect to Chrome. Start it manually.');
    process.exit(1);
  }

  let lastRefresh = Date.now();
  const REFRESH_INTERVAL = randomDelay(60000, 120000); // 60-120 seconds
  let checkCount = 0;

  console.log('[MONITOR] Monitoring started. Checks every 2s, refresh every 60-120s.');
  sendTelegram('🟢 Monitor attached. Will check for slots and refresh periodically.');

  while (true) {
    try {
      const now = Date.now();
      if (now - lastRefresh > REFRESH_INTERVAL) {
        console.log('[REFRESH] Reloading page...');
        await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
        lastRefresh = now;
      }

      // Check via text – most reliable
      const text = await page.evaluate(() => document.body.innerText);
      const hasSlot = text.includes('Select a slot') && !text.includes('No slots are currently available');

      checkCount++;
      if (hasSlot) {
        console.log(`[SLOT] FOUND at check #${checkCount}!`);
        sendTelegram('🎉 SLOT FOUND! Attempting to click...');

        // Try to click any element that might be a slot button
        const selectors = ['.sim-slot-btn', '.slot-btn', '.available-slot', '[class*="slot"]:not(.disabled)', 'button[data-time]'];
        let clicked = false;
        for (const sel of selectors) {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          // Fallback: click any button containing time like "09:30"
          const btns = await page.$$('button');
          for (const btn of btns) {
            const txt = await btn.textContent();
            if (txt && /(\d{1,2}:\d{2})/.test(txt)) {
              await btn.click();
              clicked = true;
              break;
            }
          }
        }

        if (!clicked) {
          sendTelegram('⚠️ Could not click slot – you may need to click manually.');
        } else {
          await page.waitForTimeout(1000);
          // Click book button
          const bookSelectors = ['button[type="submit"]', '.btn-book', 'button:has-text("Book")'];
          let booked = false;
          for (const sel of bookSelectors) {
            const btn = await page.$(sel);
            if (btn) {
              await btn.click();
              booked = true;
              break;
            }
          }
          sendTelegram(booked ? '✅ Appointment booked! Complete payment manually.' : '⚠️ Slot clicked but book button not found – check browser.');
        }
        await page.waitForTimeout(30000); // pause after booking
      } else if (checkCount % 20 === 0) {
        console.log(`[CHECK] #${checkCount} – no slots.`);
      }

      await page.waitForTimeout(2000);
    } catch (err) {
      console.error('[MONITOR] Error:', err.message);
      if (err.message.includes('closed') || err.message.includes('detached')) {
        console.log('[MONITOR] Reconnecting...');
        try {
          page = await connect();
        } catch (e) {
          console.error('[MONITOR] Reconnect failed:', e.message);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }
  }
})();
