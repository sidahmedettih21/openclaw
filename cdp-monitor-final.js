const { chromium } = require('playwright');
const https = require('https');
const path = require('path');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE';
const CHAT_ID = process.env.CHAT_ID || '8092143549';
const TARGET_URL = process.env.TLS_BASE_URL
  ? `${process.env.TLS_BASE_URL}/en-us/388184/workflow/appointment-booking?location=dzALG2pt`
  : 'https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt';
const CDP_PORT = 9222;
const HOT_WINDOWS = [
  { s: 8 * 60 + 55, e: 9 * 60 + 15 },
  { s: 13 * 60 + 55, e: 14 * 60 + 15 },
];

function sendTelegram(text) {
  if (!TELEGRAM_TOKEN) return;
  const data = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  });
  req.write(data);
  req.end();
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}
function nowInAlgiers() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Algiers' }));
  return d.getHours() * 60 + d.getMinutes();
}
function isHotWindow() {
  return HOT_WINDOWS.some(w => nowInAlgiers() >= w.s && nowInAlgiers() <= w.e);
}

let browser;

async function getPage() {
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No browser contexts');
  const pages = contexts[0].pages();
  if (!pages.length) throw new Error('No pages');
  return pages[0];
}

async function clickCourierIfPresent(page) {
  const btn = page.locator('button:has-text("Continue")').first();
  if (await btn.count() > 0) {
    await btn.click();
    console.log('[FLOW] Courier Continue');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }
}

async function selectMonth(page, monthValue = '04-2026') {
  const tab = page.locator(`[data-month="${monthValue}"], button:has-text("April 2026")`).first();
  if (await tab.count() > 0) {
    await tab.click();
    console.log(`[FLOW] Month ${monthValue}`);
    await page.waitForTimeout(randomDelay(300, 700));
  }
}

async function selectDay(page) {
  const day = page.locator('#sim-day-grid button.available, td.available a').first();
  if (await day.count() > 0) {
    await day.click();
    console.log('[FLOW] Day selected');
    await page.waitForTimeout(randomDelay(500, 1000));
    return true;
  }
  return false;
}

async function selectTime(page) {
  const slot = page.locator('.sim-slot-btn, .available-slot, button[data-slot], button:has-text(":")').first();
  if (await slot.count() > 0) {
    await slot.click();
    console.log('[FLOW] Time slot');
    await page.waitForTimeout(randomDelay(300, 600));
    return true;
  }
  return false;
}

async function clickBook(page) {
  const btn = page.locator('button[type="submit"], button:has-text("Book your appointment"), button:has-text("Confirm")').first();
  if (await btn.isEnabled()) {
    await btn.click();
    console.log('[FLOW] Booked');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    return true;
  }
  return false;
}

async function attemptBooking(page) {
  await clickCourierIfPresent(page);
  await selectMonth(page);
  await selectDay(page);
  await selectTime(page);
  const booked = await clickBook(page);
  if (booked) {
    const shot = path.join(__dirname, `slot_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    sendTelegram(`✅ Appointment booked! Screenshot: ${shot}`);
    return true;
  }
  return false;
}

async function monitorLoop() {
  let lastRefresh = 0;
  while (true) {
    let page;
    try {
      page = await getPage();
    } catch {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    const interval = isHotWindow() ? randomDelay(5000, 6000) : randomDelay(60000, 120000);
    if (Date.now() - lastRefresh > interval) {
      console.log('[REFRESH]');
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      lastRefresh = Date.now();
    }

    const blocked = await page.evaluate(() =>
      /you have been blocked|checking your browser|ddos/i.test(document.body.innerText)
    ).catch(() => false);
    if (blocked) {
      sendTelegram('🚫 Blocked. Waiting 5min...');
      await new Promise(r => setTimeout(r, 300000));
      continue;
    }

    const slotCount = await page.locator('.sim-slot-btn, .available-slot, button[data-slot], td.available a').count();
    if (slotCount > 0) {
      sendTelegram('🎉 Slot! Booking...');
      if (await attemptBooking(page)) {
        await page.waitForTimeout(30000);
      }
    } else {
      console.log('[CHECK] No slot');
    }

    await page.waitForTimeout(isHotWindow() ? randomDelay(4000, 5000) : randomDelay(2000, 3000));
  }
}

(async () => {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const page = await getPage();
    await page.addInitScript(() => {
      delete navigator.__proto__.webdriver;
    });
    sendTelegram('🟢 CDP monitor running');
    await monitorLoop();
  } catch (e) {
    sendTelegram(`❌ Crash: ${e.message}`);
    process.exit(1);
  }
})();