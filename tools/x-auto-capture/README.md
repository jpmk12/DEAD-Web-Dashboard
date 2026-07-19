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
   - **X list / view URLs** — one per line. Open each list/bookmarks/search in X
     and paste its URL (e.g. `https://x.com/i/lists/1234567890`,
     `https://x.com/i/bookmarks`, `https://x.com/search?q=hormuz&f=live`). Every
     URL is swept each run, one background tab at a time.
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

- `background.js` sets a `chrome.alarms` daily trigger. On fire it opens a
  background tab at your list URL, waits for X to render, injects `collector.js`
  to scroll + accumulate posts, then POSTs the `dead-x-capture` JSON to
  `<dashboard>/api/osint/x-import` with `Authorization: Bearer <token>`.
- `collector.js` is the same capture logic as the bookmarklet (deduped by post
  id, capped at 200). Re-uploading the same posts is safe — the dashboard
  dedupes by id.

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

X changes its DOM periodically. If posts arrive with missing authors/text, the
selectors need a refresh — they live at the top of `collector.js` (same suspects
as `tools/x-capture-bookmarklet.js`). Save the x.com page (Ctrl/Cmd-S, HTML only)
and hand it to Claude to fix the selectors against the real markup.

## Security notes

- The token is stored only in this browser's extension storage and only ever
  sent to your dashboard. The dashboard stores just its SHA-256 hash — the
  plaintext can't be recovered (rotate it any time from the Social pane).
- `host_permissions` includes `https://*/*` so the extension can POST to whatever
  dashboard URL you configure; the code only ever fetches `x.com` (to inject the
  collector) and your dashboard (to upload).
