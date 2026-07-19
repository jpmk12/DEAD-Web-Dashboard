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
   - **X list / view URL** — open the exact list/bookmarks/search in X and paste
     its URL (e.g. `https://x.com/i/lists/1234567890` or `https://x.com/i/bookmarks`).
   - **Daily run hour**, **collect seconds**, **max posts** — defaults are fine.
4. Click **Save**, then **Run now** to test. A background X tab opens, collects,
   uploads, and closes; the status line shows the result. Check the Social pane —
   the posts should appear in the feed.

## How it works

- `background.js` sets a `chrome.alarms` daily trigger. On fire it opens a
  background tab at your list URL, waits for X to render, injects `collector.js`
  to scroll + accumulate posts, then POSTs the `dead-x-capture` JSON to
  `<dashboard>/api/osint/x-import` with `Authorization: Bearer <token>`.
- `collector.js` is the same capture logic as the bookmarklet (deduped by post
  id, capped at 200). Re-uploading the same posts is safe — the dashboard
  dedupes by id.

## Scheduling reality

The daily run only fires while the **browser is running** (that's how
`chrome.alarms` works). For a browser you open every day, it'll catch up on the
next launch after the scheduled time. If you want it to run even when the browser
is closed, use a local OS-scheduled script instead (ask Claude to build the
Playwright variant against your Chrome profile).

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
