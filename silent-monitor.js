const { chromium } = require('playwright');
const https = require('https');
const TELEGRAM_TOKEN = '8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE';
const CHAT_ID = '8092143549';

function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const data = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const req = https.request(url, options);
  req.write(data);
  req.end();
}

async function checkSlots() {
  const profilePath = '/home/samsepi0l/.config/google-chrome/tls-work';
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profilePath, {
      executablePath: '/usr/bin/google-chrome',
      headless: true,   // invisible – no window flashing
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
        '--lang=en-US',
      ],
    });
    const page = browser.pages()[0] || await browser.newPage();
    const targetUrl = 'https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // let dynamic content load

    const hasSlot = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('Select a slot') || body.includes('appointment slots available');
    });

    if (hasSlot) {
      sendTelegram('🎉 *SLOT FOUND!* Open your Chrome profile and book it manually – fast!');
      console.log('Slot found!');
    } else {
      console.log(new Date().toLocaleTimeString(), 'No slot');
    }
  } catch (err) {
    console.error('Error:', err.message);
    sendTelegram(`⚠️ Monitor error: ${err.message.slice(0, 100)}`);
  } finally {
    if (browser) await browser.close();
  }
}

// Run every 15 seconds
setInterval(checkSlots, 15000);
checkSlots(); // run immediately
