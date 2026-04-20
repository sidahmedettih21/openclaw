const { chromium } = require('playwright');

(async () => {
  // Connect to your existing Chrome window (must be started with remote debugging)
  // First, launch Chrome manually with: google-chrome --remote-debugging-port=9222 --user-data-dir=/home/samsepi0l/.config/google-chrome/tls-work
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0]; // get the first tab

  const TELEGRAM_TOKEN = '8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE';
  const CHAT_ID = '8092143549';

  async function sendTelegram(text) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
    });
  }

  console.log('Connected to Chrome. Monitoring...');
  await sendTelegram('🟢 *Correct monitor started* – using CDP, no keyboard interference.');

  while (true) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes('Select a slot') && !text.includes('No slots are currently available')) {
      await sendTelegram('🎉 *SLOT FOUND!* Clicking...');
      // Click the first available slot (adjust selector as needed)
      await page.click('.slot-item, .available-slot, [class*="slot"]:not([class*="unavailable"])');
      await page.waitForTimeout(1000);
      // Click "Book your appointment" button
      await page.click('button:has-text("Book your appointment")');
      await sendTelegram('✅ *Appointment booked!* Complete payment manually.');
      break;
    }
    await page.waitForTimeout(2000);
  }
})();
