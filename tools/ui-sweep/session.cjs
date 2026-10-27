// Shared helpers for the browser harness: a forged LOCAL session and a page
// on the running build. Node + the preinstalled Playwright only — Playwright
// is deliberately NOT a package.json dependency (its install would drag
// esbuild-class binaries into the tree the platform cannot extract; see
// CLAUDE.md "do NOT add vitest"). Install it beside the repo instead:
//   npm i -g playwright && npx playwright install chromium
// or point PLAYWRIGHT_BROWSERS_PATH / CHROME at an existing Chromium.
//
// The session is forged with the SMOKE secret the local server was booted
// with, so this works only against a server started like
//   PORT=3218 NEXTAUTH_SECRET=smoke NEXTAUTH_URL=http://localhost:3218 \
//   OWNER_EMAIL=owner@example.com GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y node start.js
// and never against production (a production secret is never typed here).
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..", "..");
const BASE = process.env.BASE || "http://localhost:3218";
const EMAIL = process.env.SMOKE_EMAIL || "owner@example.com";
const SECRET = process.env.SMOKE_SECRET || "smoke";

function loadPlaywright() {
  try { return require("playwright"); } catch { /* fall through */ }
  try { return require(path.join(ROOT, "node_modules", "playwright")); } catch { /* fall through */ }
  throw new Error("playwright is not installed. `npm i -g playwright && npx playwright install chromium` — do NOT add it to package.json.");
}

async function forgeSession() {
  const { encode } = await import(pathToFileURL(path.join(ROOT, "node_modules", "@auth", "core", "jwt.js")).href);
  return encode({
    secret: SECRET,
    salt: "authjs.session-token",
    token: { email: EMAIL, name: "Smoke", sub: "1", accessToken: "fake", accessTokenExpires: Date.now() + 3600_000 },
  });
}

/** A new context + page holding the forged session, landed on the dashboard. */
async function openApp(browser, { viewport = { width: 1400, height: 1000 }, settleMs = 2500, mobile = false } = {}) {
  const jwt = await forgeSession();
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  await ctx.addCookies([{ name: "authjs.session-token", value: jwt, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(settleMs);
  return { ctx, page, errors };
}

/** Navigate through the app's own door (TabShell listens for app:navigate). */
async function goTab(page, tab, settleMs = 2500) {
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("app:navigate", { detail: t })), tab);
  await page.waitForTimeout(settleMs);
}

/** Close any open drawer / modal by its header Close button, then Escape. */
async function closeOverlays(page) {
  for (let k = 0; k < 3; k++) {
    const close = page.locator('div.fixed button[aria-label="Close"]:visible').first();
    if (!(await close.count())) break;
    await close.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Escape").catch(() => {});
}

module.exports = { ROOT, BASE, EMAIL, loadPlaywright, forgeSession, openApp, goTab, closeOverlays };
