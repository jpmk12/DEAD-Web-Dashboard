#!/usr/bin/env node
// The lazy-mount regression check (CLAUDE.md "Lazy components render on
// arrival"). On a FRESH page, after an idle long enough that nothing in the
// shell re-renders on its own, open the Preferences drawer and the Family
// tab and expect each within LIMIT_MS. With `next/dynamic` they took 22 s
// or never; with lib/lazyClient they take ~250 ms.
//
//   BASE=http://localhost:3218 node tools/ui-sweep/lazy-check.cjs
//   IDLE_MS=35000 (default) LIMIT_MS=2500 (default)
const { loadPlaywright, openApp, goTab } = require("./session.cjs");

const IDLE_MS = Number(process.env.IDLE_MS || 35_000);
const LIMIT_MS = Number(process.env.LIMIT_MS || 2_500);

async function waitFor(page, fn, max) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await page.evaluate(fn)) return Date.now() - t0; await page.waitForTimeout(100); }
  return -1;
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let failed = false;
  try {
    const { ctx, page } = await openApp(browser, { settleMs: IDLE_MS });
    const t0 = Date.now();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("prefs:open", { detail: "email" })));
    const drawerAt = await waitFor(page, () => !!document.querySelector("div.fixed.z-50"), 30_000);
    const sectionAt = drawerAt < 0 ? -1 : (Date.now() - t0) + await waitFor(page, () => !!document.getElementById("prefs-group-email") && !document.getElementById("prefs-group-email").classList.contains("hidden"), 10_000);
    const okDrawer = drawerAt >= 0 && drawerAt <= LIMIT_MS;
    console.log(`${okDrawer ? "ok  " : "FAIL"} preferences drawer after ${IDLE_MS / 1000}-s idle: frame at ${drawerAt} ms, email section at ${sectionAt} ms (limit ${LIMIT_MS} ms)`);
    failed ||= !okDrawer;
    await ctx.close();
  } catch (e) { console.log("FAIL preferences drawer:", String(e.message || e).slice(0, 200)); failed = true; }
  try {
    const { ctx, page } = await openApp(browser, { settleMs: IDLE_MS });
    const t0 = Date.now();
    await goTab(page, "family", 0);
    const at = await waitFor(page, () => /roster|needs you|school|household|loading family/i.test(document.querySelector("main")?.innerText || ""), 30_000);
    const content = await waitFor(page, () => /roster|needs you|school|household/i.test(document.querySelector("main")?.innerText || ""), 30_000);
    const ok = at >= 0 && at <= LIMIT_MS;
    console.log(`${ok ? "ok  " : "FAIL"} family tab after ${IDLE_MS / 1000}-s idle: placeholder or content at ${at} ms, content at ${content < 0 ? "never" : `${Date.now() - t0} ms`} (limit ${LIMIT_MS} ms)`);
    failed ||= !ok;
    await ctx.close();
  } catch (e) { console.log("FAIL family tab:", String(e.message || e).slice(0, 200)); failed = true; }
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error("FAILED", e); process.exit(2); });
