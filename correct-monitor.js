const { chromium } = require('playwright');
const https = require('https');

const TELEGRAM_TOKEN = '8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE';
const CHAT_ID = '8092143549';

function sendTelegram(text) {
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

async function getCurrentPage(browser) {
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('No browser contexts');
  const pages = contexts[0].pages();
  if (pages.length === 0) throw new Error('No pages');
  return pages[0];
}

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('Connected to Chrome. Monitoring...');
    sendTelegram('🟢 Monitor started – checking for .sim-slot-btn (simulation) or real slot buttons.');
  } catch (err) {
    console.error('Failed to connect:', err.message);
    sendTelegram(`❌ Cannot connect to Chrome. Is it running with --remote-debugging-port=9222?`);
    process.exit(1);
  }

  let lastUrl = '';

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const page = await getCurrentPage(browser);
      const currentUrl = page.url();

      if (currentUrl !== lastUrl) {
        console.log(`Page changed to: ${currentUrl}`);
        lastUrl = currentUrl;
      }

      // Check for actual slot buttons: in simulation they have class "sim-slot-btn"
      const hasSlot = await page.$('.sim-slot-btn') !== null;

      if (hasSlot) {
        sendTelegram('🎉 SLOT FOUND! Attempting to click...');
        try {
          // Click the first sim-slot-btn (simulation) or fallback to any button that looks like a slot
          const slotBtn = await page.$('.sim-slot-btn');
          if (slotBtn) {
            await slotBtn.click();
          } else {
            // Fallback for real site – adjust selector when you know the real class
            await page.click('.slot-item, .available-slot, [class*="slot"]:not([class*="unavailable"])');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Click the book button (simulation uses generic 'button[type="submit"]')
          const bookBtn = await page.$('button[type="submit"]');
          if (bookBtn) await bookBtn.click();
          else await page.click('button:has-text("Book your appointment")');
          sendTelegram('✅ Appointment booked! Complete payment manually.');
          break;
        } catch (clickErr) {
          sendTelegram(`⚠️ Click failed: ${clickErr.message.slice(0, 150)}. You may need to click manually.`);
        }
      }
    } catch (err) {
      if (err.message.includes('Execution context was destroyed')) {
        console.log('Page context lost – reconnecting...');
        continue;
      }
      console.error('Error:', err.message);
    }
  }
})();