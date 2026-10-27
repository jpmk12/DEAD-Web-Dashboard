# ui-sweep — drive the real build in headless Chromium

A small harness that found two "the button does nothing" bugs on
2026-10-27 that no unit test could see: the Crisis-map popovers closing on
the mousedown that was meant to pick a preset, and every lazily loaded
component (Preferences, Family, the map) waiting for an unrelated re-render
before it appeared. It drives the PRODUCTION build with a session cookie
forged from the smoke secret, so it needs no Google login and no database;
API routes answer 500 and the UI must still stand up.

Playwright is **not** a dependency of the app and must never be added to
`package.json` (CLAUDE.md: anything that pulls an install-time binary into
the tree breaks the platform's extract). Install it beside the repo:

```
npm i -g playwright && npx playwright install chromium
```

(The build sandbox already has it; its Chromium lives at
`/opt/pw-browsers/chromium`.)

## Run

1. Build and boot the app with the smoke environment, on a spare port:

```
node build.js
PORT=3218 NEXTAUTH_SECRET=smoke NEXTAUTH_URL=http://localhost:3218 \
OWNER_EMAIL=owner@example.com GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y node start.js
```

2. Run a check against it:

```
BASE=http://localhost:3218 node tools/ui-sweep/sweep.cjs        # every tab, every menu, desk + phone
BASE=http://localhost:3218 node tools/ui-sweep/lazy-check.cjs   # drawer + Family open within 2.5 s after a 35-s idle
BASE=http://localhost:3218 node tools/ui-sweep/map-check.cjs    # View presets, Layers chips, the radar note
```

Exit code 1 means a finding; 2 means the harness itself failed.

## Reading the sweep

- **ErrorBoundary showing / pageerror** — a render crash. Always real.
- **horizontal overflow** on the phone pass — always real.
- **inert control** — a ▾ / ▴ / ⚙ button whose click changed nothing in
  900 ms. Real when the control should open something (that is how the
  popover bug read). A false positive when, without a database, the thing
  it folds is empty, so only the glyph changes — open the control by hand
  before fixing.

## Writing a new probe

`session.cjs` exports `openApp(browser, { viewport, mobile, settleMs })`,
`goTab(page, tab)` (dispatches the app's own `app:navigate` event) and
`closeOverlays(page)`. Move around through window events the app already
listens for (`app:navigate`, `prefs:open`, `osint:set-pane`,
`watch:focus`) rather than clicking the nav, so a probe survives a layout
change. Never put a production secret or address in a probe.
