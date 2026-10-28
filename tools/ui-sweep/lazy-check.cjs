#!/usr/bin/env node
// The lazy-mount regression check (CLAUDE.md "Lazy components render on
// arrival"). On a FRESH page, after an idle long enough that nothing in the
// shell re-renders on its own, open the Preferences drawer and the Family
// tab and expect each within LIMIT_MS. With `next/dynamic` they took 22 s
// or never; with lib/lazyClient they take ~250 ms. Since 2026-10-28 it also
// opens every surface split out of the first-load chunk (Docs, Economy,
// Weather, Tools, Calendar, Email, the assistant, the ⌘K palette) on one
// idle page, and fires a `docs:open` door BEFORE the Docs tab has mounted —
// the shell parks it (lib/doorBuffer) and the editor must still fetch it.
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
  try {
    const { ctx, page } = await openApp(browser, { settleMs: IDLE_MS });
    const asked = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname.includes("lazy-door-probe")) asked.push(r.url()); });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("app:navigate", { detail: "docs" }));
      setTimeout(() => window.dispatchEvent(new CustomEvent("docs:open", { detail: "lazy-door-probe" })), 60);
    });
    const doorAt = await waitFor(page, () => /docs|logs|no document|new log|loading docs/i.test(document.querySelector("main")?.innerText || ""), 30_000);
    await page.waitForTimeout(1_500);
    const okDoor = doorAt >= 0 && doorAt <= LIMIT_MS && asked.length > 0;
    console.log(`${okDoor ? "ok  " : "FAIL"} docs door fired before the tab mounted: tab at ${doorAt} ms, editor fetched the doc: ${asked.length ? "yes" : "NO"}`);
    failed ||= !okDoor;
    const SURFACES = [
      ["markets", /economic warfare|loading economy/i],
      ["weather", /places|space weather|loading weather/i],
      ["tools", /julian|h-hour|loading tools/i],
      ["calendar", /upcoming|today|calendar|loading calendar/i],
      ["email", /email|inbox|priority|sign in|loading email/i],
    ];
    for (const [tab, re] of SURFACES) {
      await goTab(page, tab, 0);
      const at = await waitFor(page, new Function(`return ${re}.test(document.querySelector("main")?.innerText || "")`), 30_000);
      const ok = at >= 0 && at <= LIMIT_MS;
      console.log(`${ok ? "ok  " : "FAIL"} ${tab} tab (lazy chunk): placeholder or content at ${at} ms`);
      failed ||= !ok;
    }
    await goTab(page, "glance", 0);
    await page.locator("button", { hasText: /^Assistant$/ }).click();
    const asAt = await waitFor(page, () => !!document.querySelector("textarea") || /loading the assistant/i.test(document.body.innerText), 30_000);
    const asOk = asAt >= 0 && asAt <= LIMIT_MS;
    console.log(`${asOk ? "ok  " : "FAIL"} assistant panel (lazy chunk): at ${asAt} ms`);
    failed ||= !asOk;
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    const palAt = await waitFor(page, () => !!document.querySelector("[role=dialog] input, [role=dialog]"), 30_000);
    const palOk = palAt >= 0 && palAt <= LIMIT_MS;
    console.log(`${palOk ? "ok  " : "FAIL"} ⌘K palette (lazy chunk): at ${palAt} ms`);
    failed ||= !palOk;
    await ctx.close();
  } catch (e) { console.log("FAIL lazy surfaces:", String(e.message || e).slice(0, 200)); failed = true; }
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error("FAILED", e); process.exit(2); });
