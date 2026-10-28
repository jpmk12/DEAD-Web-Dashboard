# DEAD X Auto-Capture (browser extension)

Unattended version of the X-capture bookmarklet. Instead of you tapping the
bookmarklet and uploading a file, this runs on a **daily schedule inside your own
logged-in browser**, scrolls your configured X list, and uploads the posts
straight to your dashboard.

**It keeps the exact safety model of the bookmarklet:** the capture runs in *your*
browser session from *your* IP. It sends **nothing to X**, reads **no
credentials**, and uses no X API. The only thing it sends anywhere is the
collected posts → your own dashboard, authorized by a per-user token.

> This is still "automation" in X's eyes — the same behavior as the bookmarklet,
> just on a timer. Risk is far lower than server-side/datacenter scraping (real
> session, human-paced scrolling) but not zero. Use your own judgment.

## Setup

1. **Generate an upload token** on the dashboard: **OSINT → Social → 𝕏 Capture
   import → Auto-capture (⚙)** → *Generate token*. Copy it (shown once).
2. **Load the extension** (Chrome/Edge):
   - Go to `chrome://extensions` (or `edge://extensions`).
   - Turn on **Developer mode**.
   - **Load unpacked** → select this `tools/x-auto-capture/` folder.
3. **Open the extension's options** (Details → Extension options, or click the
   toolbar icon) and fill in:
   - **Dashboard URL** — your site root (e.g. `https://your-dashboard.com`).
   - **Upload token** — the `xcap_…` value from step 1.
   - **Capture targets** — one URL per line, swept each run. Two kinds, auto-
     detected by host:
     - **X** lists/bookmarks/searches (`https://x.com/i/lists/…`,
       `https://x.com/i/bookmarks`, `https://x.com/search?q=hormuz&f=live`) →
       collected as posts.
     - **LiveUAMap** region maps (`https://iran.liveuamap.com`,
       `https://israelpalestine.liveuamap.com`, also syria/yemen/isis/emirates
       .liveuamap.com) → geolocated conflict/incident events. LiveUAMap blocks
       datacenter IPs, so it can only be captured from your own browser — no
       login needed, it's a public site.
     - **MOFCOM** (PRC Ministry of Commerce) announcement lists or single
       notices → official export-control / unreliable-entity / anti-dumping
       records. The old `/zwgk/gkzcfb/` path is **404** on the redesigned
       site (seen 2026-10-26). Use the official bulletin mirror, which
       republishes every announcement and whose article shape the collector
       knows: `https://bgt.mofcom.gov.cn/wg/` — and/or the main site's
       announcements list `https://www.mofcom.gov.cn/zwgk/zcfb/` (unverified;
       if the run log says `404 Not Found`, open mofcom.gov.cn → 政务公开 →
       公告 and paste the URL the browser shows). The English
       `https://english.mofcom.gov.cn/…` policy-release pages and any single
       notice's permalink also work. Credited to the **China** actor on the Economy tab's economic-
       warfare board. MOFCOM has no API; this is the only way those notices
       reach the dashboard. Public site, no login.
     - **UKMTO** recent incidents (`https://www.ukmto.org/recent-incidents`)
       → the Royal Navy's maritime incident log (attacks, boardings,
       suspicious approaches, advisories) for the Gulf, Red Sea and Gulf of
       Aden. The dashboard also tries to fetch the page itself, but UKMTO is
       reported to refuse automated access, so add it here to be sure: each
       entry joins the Economy tab's chokepoint board, the I&W chokepoint
       indicator and the Crisis map's **Maritime** layer, with its UKMTO
       reference and position. Public site, no login.
   - **Capture every (hours)** — how often to run. `6` is a good cadence for
     active threat-watching; `24` = once daily. Floor is 3h (more often is
     diminishing returns and more automation footprint).
   - **Preferred hour** — used only when the interval is 24 (the daily run time).
   - **Collect seconds / Max per list** — defaults are fine.
4. Click **Save**, then **Run now** to test. A background X tab opens, collects,
   uploads, and closes; the status line shows the result. Check the Social pane —
   the posts should appear in the feed.

## Reader capture (articles you're reading)

Separate from the scheduled X sweep: **click the toolbar icon while reading an
article** (e.g. WSJ via DoD MWR Libraries) to capture *that* piece. The extension
extracts the title/byline/date/body from the page you're on and uploads it to
`<dashboard>/api/capture/article`. A green ✓ badge = captured; the article shows
up in OSINT → feed (kind "news") and feeds the I&W corroboration layer.

This is **manual, one article at a time** — the piece you chose to read — not a
harvester. It runs in your own authenticated session; nothing is sent to the
source. It's the same fair-use logic as the X capture: your access, your view,
personal use in your private dashboard.

If a page comes back with a thin/empty body, the source's DOM needs a selector
tweak — they live at the top of `article.js`. Save the page (Ctrl/Cmd-S) and hand
it to Claude to tune.

## How it works

- `background.js` sets a `chrome.alarms` daily trigger. On fire it opens your
  list URL in a **small unfocused window of its own** (1.2.7 — Chrome pauses
  rendering in a background tab, and X only loads the next few posts as the
  list renders, so a hidden tab stalled at 4–9 posts), waits for X to render,
  injects `collector.js` to scroll + accumulate posts, closes the window, then
  POSTs the `dead-x-capture` JSON to `<dashboard>/api/osint/x-import` with
  `Authorization: Bearer <token>`. X gets at least 45 s whatever the
  duration setting. Other sites still use a background tab.
- `collector.js` is the same capture logic as the bookmarklet (deduped by post
  id, capped at 200). It scrolls to consume: progress is new posts, and it
  only stops after 12 s with none (nudging and pressing X's Retry meanwhile).
  The run log line `[collector: ended … · posts … · scrolls … · tab visible]`
  says why it stopped and whether the tab was visible. Re-uploading the same
  posts is safe — the dashboard dedupes by id.
- An upload answered 502/503/504 **with no body** (the host's gateway, not the
  dashboard) is retried once after 8 s.

## Scheduling reality

The run only fires while the **browser is running** (that's how `chrome.alarms`
works). For a browser you open every day, it'll catch up on the next launch after
a missed slot. If you want it to run even when the browser is closed, use a local
OS-scheduled script instead (ask Claude to build the Playwright variant against
your Chrome profile).

The dashboard's freshness pill (OSINT → Social) learns your interval from the
uploads and turns amber/red if it stops hearing from the extension on schedule —
so you can tell at a glance whether the pipeline is healthy.

## When captures come back empty

An empty target line now says what the tab actually showed, in brackets:
`[page: login wall · 1,204 chars · 31 links · “Log in to X”]`,
`[page: bot challenge · …]`, `[page: landed on x.com/i/flow/login …]`,
`[page: page rendered no text]`, or — the one that needs a fix — plenty of
chars and links with **0 items**, which means the page rendered and the
collector no longer recognises its markup. For that case save the page
(Ctrl/Cmd-S, "Webpage, HTML only") and hand it to Claude: the selectors live
at the top of `collector.js` (X), `liveuamap.js`, `mofcom.js` and `ukmto.js`.
Every collector waits at least ~12 s for a slow page before calling it empty.

A `Capture failed — the database refused the row — a value is too long for
column '…'` line is the dashboard's, not the page's: the capture worked and the
server rejected one field. Report it as is; the column name is the fix.

## Security notes

- The token is stored only in this browser's extension storage and only ever
  sent to your dashboard. The dashboard stores just its SHA-256 hash — the
  plaintext can't be recovered (rotate it any time from the Social pane).
- `host_permissions` includes `https://*/*` so the extension can POST to whatever
  dashboard URL you configure; the code only ever fetches `x.com` (to inject the
  collector) and your dashboard (to upload).
