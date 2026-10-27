#!/usr/bin/env node
// Walk every tab of the running build in headless Chromium, at desktop and
// phone widths, and report the three failures a user reads as "it does
// nothing": a render crash (the ErrorBoundary text or a page error), an
// INERT control (a ▾ / ▴ / ⚙ button whose click changes nothing within a
// second), and horizontal overflow on a phone. This is the sweep that found
// the Crisis-map popover bug and the lazy-mount bug on 2026-10-27.
//
//   BASE=http://localhost:3218 node tools/ui-sweep/sweep.cjs
//
// Known false positives WITHOUT a database (the API routes answer 500):
// a fold whose body is empty because nothing loaded (the command board's
// "fold ▴" / "★ Must-tracks ▾") reads inert — the glyph swap is the only
// change and it is the same length. Judge an "inert" line by opening it.
const { loadPlaywright, openApp, goTab, closeOverlays } = require("./session.cjs");

const TABS = ["glance", "news", "calendar", "email", "family", "docs", "osint", "markets", "weather", "tools"];
const OUT = process.env.OUT || null; // directory for screenshots, optional

async function sweep(browser, viewport, label, mobile) {
  const { ctx, page, errors } = await openApp(browser, { viewport, mobile });
  const findings = [];
  for (const tab of TABS) {
    await goTab(page, tab);
    const crashed = await page.locator("text=/failed to render/i").count();
    if (crashed) findings.push(`[${label}/${tab}] ErrorBoundary showing (${crashed})`);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (ov.sw > ov.iw + 2) findings.push(`[${label}/${tab}] horizontal overflow: scrollWidth ${ov.sw} > ${ov.iw}`);

    const btns = page.locator("button:visible").filter({ hasText: /[▾▴⚙]|…$/ });
    const n = Math.min(await btns.count(), 40);
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      let text = "";
      try {
        text = (await b.innerText({ timeout: 1000 })).replace(/\s+/g, " ").trim().slice(0, 40);
        if (!text || /^(hide|show)/i.test(text)) continue;
        const before = await page.evaluate(() => document.body.innerHTML.length);
        const ariaBefore = await b.getAttribute("aria-expanded");
        await b.scrollIntoViewIfNeeded({ timeout: 2000 });
        await b.click({ timeout: 2000 });
        await page.waitForTimeout(900);
        const after = await page.evaluate(() => document.body.innerHTML.length);
        const ariaAfter = await b.getAttribute("aria-expanded").catch(() => null);
        const changed = Math.abs(after - before) > 20 || (ariaBefore !== null && ariaBefore !== ariaAfter);
        if (!changed) findings.push(`[${label}/${tab}] inert control: “${text}”`);
        await closeOverlays(page);
        if (changed && (await b.getAttribute("aria-expanded").catch(() => null)) === "true") {
          await b.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(120);
        }
      } catch (e) {
        findings.push(`[${label}/${tab}] could not drive “${text}”: ${String(e.message || e).split("\n")[0].slice(0, 120)}`);
      }
    }
    if (OUT) await page.screenshot({ path: `${OUT}/sweep-${label}-${tab}.png` }).catch(() => {});
  }
  for (const e of errors) findings.push(`[${label}] pageerror: ${e}`);
  await ctx.close();
  return findings;
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const desk = await sweep(browser, { width: 1400, height: 1000 }, "desk", false);
    const phone = await sweep(browser, { width: 390, height: 844 }, "phone", true);
    const all = [...desk, ...phone];
    console.log(all.length ? all.join("\n") : "no findings");
    process.exitCode = all.some((f) => /ErrorBoundary|pageerror|overflow/.test(f)) ? 1 : 0;
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error("FAILED", e); process.exit(2); });
