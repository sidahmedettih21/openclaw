// ~/visa-agent/src/browser.ts
import { chromium, type BrowserContext } from "playwright";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";

// ------------------------------------------------------------------
// Stealth arguments – tuned for TLScontact / Cloudflare
// ------------------------------------------------------------------
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-ipc-flooding-protection",
  "--disable-features=IsolateOrigins,site-per-process,ChromeWhatsNewUI,OptimizationHints",
  "--disable-site-isolation-trials",
  "--disable-web-security",            // only needed for some sites; remove if causes issues
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-client-side-phishing-detection",
  "--disable-crash-reporter",
  "--disable-logging",
  "--disable-notifications",
  "--no-first-run",
  "--no-default-browser-check",
  "--use-fake-ui-for-media-stream",
  "--password-store=basic",
  "--use-mock-keychain",
  "--window-size=1280,800",
  "--start-maximized",
  "--lang=en-US",
  `--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
];

// ------------------------------------------------------------------
// Domains that must be allowed so Chrome's internal connectivity
// checks succeed (prevents ERR_INTERNET_DISCONNECTED)
// ------------------------------------------------------------------
const ALLOWED_DOMAINS = [
  "visas-pt.tlscontact.com",
  "tlscontact.com",
  "connectivitycheck.gstatic.com",
  "clients1.google.com",
  "clients2.google.com",
  "clients3.google.com",
  "clients4.google.com",
  "www.gstatic.com",
  "gstatic.com",
  "cloudflare.com",
  "challenges.cloudflare.com",
];

function isAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Create a temporary copy of the profile to avoid ProcessSingleton lock
// ------------------------------------------------------------------
export async function createBrowserContext(
  originalProfilePath: string,
  executablePath: string = "/usr/bin/google-chrome"
): Promise<BrowserContext> {
  // 1. Create a temporary directory for this run
  const tempProfile = path.join(os.tmpdir(), `tls-work-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempProfile, { recursive: true });

  // 2. Copy the original profile (if it exists)
  if (existsSync(originalProfilePath)) {
    await fs.cp(originalProfilePath, tempProfile, { recursive: true, force: true });
  }

  // 3. Launch persistent context with the temporary copy
  const ctx = await chromium.launchPersistentContext(tempProfile, {
    executablePath,
    headless: false,      // must be false for Cloudflare; use Xvfb if you need true headless
    args: STEALTH_ARGS,
    permissions: [],
    locale: "en-US",
    timezoneId: "Africa/Algiers",
    viewport: { width: 1280, height: 800 },
  });

  // 4. Patch navigator.webdriver and other properties
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
    // Override permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: "denied" } as PermissionStatus)
        : originalQuery(parameters);
    // Fake connection
    Object.defineProperty(navigator, "connection", {
      get: () => ({ rtt: 50, downlink: 10, saveData: false }),
    });
  });

  // 5. Route interception – allow only whitelisted domains (critical for connectivity)
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowed(url)) {
      await route.continue();
    } else {
      // Silently block non‑whitelisted requests (avoids noise)
      await route.abort("blockedbyclient");
    }
  });

  // 6. Block dangerous schemes
  await ctx.route("file://**", (route) => route.abort("blockedbyclient"));
  await ctx.route("data:text/html**", (route) => route.abort("blockedbyclient"));

  // 7. Schedule cleanup of the temporary profile after the context closes
  ctx.on("close", async () => {
    try {
      await fs.rm(tempProfile, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  return ctx;
}