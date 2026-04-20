const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launchPersistentContext(
    process.env.CHROME_USER_DATA + '/' + process.env.CHROME_PROFILE,
    {
      executablePath: process.env.CHROME_BIN,
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    }
  );
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://visas-pt.tlscontact.com/appointments/check', { waitUntil: 'networkidle' });
  // Wait for manual inspection
  console.log('Browser open. Inspect fields, then press Enter to close.');
  await new Promise(r => process.stdin.once('data', r));
  await browser.close();
})();
