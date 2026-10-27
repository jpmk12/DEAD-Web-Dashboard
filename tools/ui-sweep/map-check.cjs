#!/usr/bin/env node
// The Crisis-map toolbar check (CLAUDE.md "Crisis map radar" → the popover
// fix): a View preset must apply, the Layers popover must stay open while a
// chip is toggled and close on an outside click, and a Radar layer with no
// frames must SAY so on the map and in the source-down badge.
//
//   BASE=http://localhost:3218 node tools/ui-sweep/map-check.cjs
const { loadPlaywright, openApp, goTab } = require("./session.cjs");

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok) => { results.push(`${ok ? "ok  " : "FAIL"} ${name}`); };
  try {
    const { ctx, page } = await openApp(browser);
    const layers = () => page.evaluate(() => JSON.parse(localStorage.getItem("crisisMap:layers") || "{}"));
    await goTab(page, "osint", 2000);
    const viewBtn = page.getByRole("button", { name: /^(View|Standard|HADR|Contested|Mobility|Force|My AO) ▾$/ }).first();
    await viewBtn.waitFor({ timeout: 30_000 });
    const wrap = viewBtn.locator("xpath=..");

    await viewBtn.click();
    const mob = wrap.getByRole("button", { name: /^Mobility/ });
    check("View menu opens", (await mob.count()) === 1);
    const before = await layers();
    await mob.click();
    await page.waitForTimeout(500);
    const after = await layers();
    check("Mobility preset applies (airfields + rings on, disasters off)", after.airfields === true && after.rings === true && after.disasters === false && JSON.stringify(before) !== JSON.stringify(after));
    // After the pick the trigger button itself reads "Mobility ▾", so count the
    // dropdown panel, not a button named Mobility.
    check("View menu closes after a pick", (await wrap.locator("div.absolute").count()) === 0);
    await page.waitForTimeout(3000);
    check("preset survives 3 s (no hydration revert)", JSON.stringify(await layers()) === JSON.stringify(after));

    const layersBtn = page.getByRole("button", { name: /Layers \(\d+\)/ });
    await layersBtn.click();
    const lw = layersBtn.locator("xpath=..");
    const radar = lw.getByRole("button", { name: /Radar$/ });
    check("Layers popover opens", (await radar.count()) === 1);
    await radar.click();
    await page.waitForTimeout(600);
    check("Radar chip toggles and the popover stays open", (await layers()).radar === true && (await radar.count()) === 1);
    await page.mouse.click(700, 140);
    await page.waitForTimeout(300);
    check("Layers popover closes on an outside click", (await radar.count()) === 0);
    const note = await page.locator("text=/radar: (no frames|tiles refused)/").count();
    const frames = await page.evaluate(() => fetch("/api/osint/radar").then((r) => r.json()).then((d) => (d.frames || []).length).catch(() => -1));
    check(`Radar with ${frames} frame(s): ${frames > 0 ? "no note expected" : "the map names the outage"}`, frames > 0 ? note === 0 : note === 1);
    await ctx.close();
  } catch (e) { results.push(`FAIL harness: ${String(e.message || e).split("\n")[0].slice(0, 200)}`); }
  await browser.close();
  console.log(results.join("\n"));
  process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
}
main().catch((e) => { console.error("FAILED", e); process.exit(2); });
