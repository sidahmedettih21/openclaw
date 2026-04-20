#!/bin/bash
# Diagnostic script to test browser fingerprint against TLScontact

cd ~/visa-agent
echo "=== Browser Fingerprint Diagnostic ==="
echo "Launching headed browser (visible) to check headers..."
echo "You will see a browser window. Wait 5 seconds, then check the console output."
echo ""

# Create a temporary test script
cat > /tmp/fingerprint-test.js << 'JSEOF'
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launchPersistentContext(
    process.env.CHROME_USER_DATA + '/' + process.env.CHROME_PROFILE,
    {
      executablePath: process.env.CHROME_BIN,
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--metrics-recording-only',
        '--no-first-run',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  );
  const page = await browser.newPage();
  await page.goto('https://visas-pt.tlscontact.com', { waitUntil: 'networkidle', timeout: 15000 });
  // Capture response headers
  const request = await page.request.fetch('https://visas-pt.tlscontact.com');
  console.log('Response status:', request.status());
  console.log('Response headers:', JSON.stringify(request.headers(), null, 2));
  // Also check navigator.webdriver
  const webdriver = await page.evaluate(() => navigator.webdriver);
  console.log('navigator.webdriver:', webdriver);
  // Take screenshot
  await page.screenshot({ path: '/tmp/tlscontact-debug.png', fullPage: true });
  console.log('Screenshot saved to /tmp/tlscontact-debug.png');
  await browser.close();
})();
JSEOF

# Run the test
npx tsx /tmp/fingerprint-test.js
