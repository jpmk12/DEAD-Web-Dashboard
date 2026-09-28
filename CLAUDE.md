# CLAUDE.md — Node.js Hosting

This project is built to deploy on Node.js Hosting, a managed Node.js hosting platform. Use this file as context when helping build, debug, or prepare this app for deployment.

## Platform Overview

Node.js Hosting is a managed Node.js PaaS that supports Node.js applications and static sites. Customers upload their project folder through the GoDaddy interface — no Docker, no CI/CD pipelines, no infrastructure config needed. The platform handles SSL, CDN, and server-side compute automatically.

## Deployment Flow

1. Customer uploads their project folder via the Node.js Hosting UI
2. The platform installs dependencies and builds the app
3. The app is deployed to a private preview environment (requires GoDaddy auth to view)
4. Once ready, the customer can publish to production and connect a custom domain

## Requirements

### package.json

Every project must have a valid `package.json` in the root directory with a `start` script. This is how the platform knows how to run the app.

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}
```

The platform runs `npm install` followed by `npm start` to boot the application.

### Entry Point

The app needs a clear entry point referenced by the `start` script. Common patterns:

- `node server.js`
- `node index.js`
- `node app.js`
- `next start` (for Next.js apps)

### Port Binding

The app must listen on the port provided by the `PORT` environment variable. Do not hardcode a port.

```javascript
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

### Static Sites

For static sites with no server-side logic, include a simple server that serves the static files:

```javascript
const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port);
```

## Supported Frameworks

Node.js Hosting supports any Node.js application or framework that can run via `npm start`. This includes but is not limited to:

- Express.js
- Next.js
- Fastify
- Nuxt.js
- Remix
- Nest.js
- Hono
- Koa
- Static sites served via a Node.js server

If your framework produces a production build and can start via a `"start"` script, it will work on Node.js Hosting.

## Single Application Per Upload

Node.js Hosting expects a single application per upload. Monorepos and multi-app setups are not supported unless a single `npm start` command at the root boots everything the app needs.

If your project is a monorepo, extract the specific app you want to deploy into its own folder with its own `package.json` and upload that folder instead.

For example, if your repo has a structure like `packages/api` and `packages/web`, upload just `packages/web` as a standalone project with its own complete `package.json` and `start` script.

## Project Structure

The platform is flexible with structure. As long as the root contains a valid `package.json` with a `start` script, the app will deploy. A typical structure looks like:

```
my-app/
├── package.json        # Required — must include "start" script
├── server.js           # Entry point (or index.js, app.js, etc.)
├── public/             # Static assets (if applicable)
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── routes/             # API routes (if applicable)
├── views/              # Templates (if applicable)
├── .env.example        # Document required env vars (do not upload .env)
└── CLAUDE.md           # This file
```

## Environment Variables

- `PORT` is provided automatically by the platform. Always use `process.env.PORT`.
- Any additional environment variables needed by the app can be configured through the Node.js Hosting UI after upload.
- Never commit secrets or `.env` files in the upload folder.

## What the Platform Handles

You do not need to configure or worry about:

- SSL/TLS certificates — provisioned automatically
- CDN — included out of the box
- Process management — the platform manages restarts and uptime
- Server infrastructure — fully managed compute

## Deploying from AI Coding Tools

Many customers build their apps using AI-powered tools like Replit, Lovable, Bolt, Cursor, or Claude. These apps can be deployed on Node.js Hosting, but often need small adjustments before they're ready.

### How to get your code onto Node.js Hosting

1. Export or download your project as a zip from the AI tool
2. Unzip the folder locally
3. Check and fix the common issues below
4. Upload the folder through the Node.js Hosting UI

### Common issues and fixes

**Missing or incomplete `package.json`**
Some AI tools don't generate a complete `package.json`. Make sure yours exists in the root and includes a `"start"` script. If it's missing, create one:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {}
}
```

Then run `npm install` locally to generate the correct dependencies.

**Hardcoded ports**
AI tools often hardcode a port like `3000` or `8080`. Replace any hardcoded port with `process.env.PORT`:

```javascript
// Before (common in AI-generated code)
app.listen(3000);

// After (ready for Node.js Hosting)
app.listen(process.env.PORT || 3000);
```

**Dependencies in the wrong place**
AI tools sometimes put production dependencies under `"devDependencies"`. Move anything the app needs at runtime into `"dependencies"`.

**Missing entry point**
Make sure the file referenced in your `"start"` script actually exists. AI tools sometimes generate a `main.js` but the start script points to `index.js`, or vice versa.

**Replit-specific files**
Replit projects often include `.replit` and `replit.nix` config files. These are not needed and can be removed before upload. Focus on having a clean `package.json` with the correct `"start"` script.

**Lovable / Bolt exports**
These tools often export frontend-only apps with no server. If your export doesn't include a server file, add a simple one to serve your static files:

```javascript
const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port);
```

Make sure to add `express` to your dependencies: `npm install express --save`

### Quick validation

Before uploading, run this locally to confirm everything works:

```bash
npm install
npm start
```

If your app starts and is accessible at `http://localhost:3000` (or whatever port), it's ready for Node.js Hosting.

## Framework Setup Examples

### Express.js
Ensure `express` is in `dependencies` (not `devDependencies`) and the `start` script points to your server file.

### Next.js
Use `next build` as a `build` script and `next start` as the `start` script:

```json
{
  "scripts": {
    "build": "next build",
    "start": "next start"
  }
}
```

Next.js apps work out of the box with server-side rendering, API routes, and static generation.

### Nuxt.js
Similar to Next.js — build then start:

```json
{
  "scripts": {
    "build": "nuxt build",
    "start": "node .output/server/index.mjs"
  }
}
```

### Remix

```json
{
  "scripts": {
    "build": "remix build",
    "start": "remix-serve build"
  }
}
```

### Fastify
Same pattern as Express — bind to `process.env.PORT` and use `0.0.0.0` as the host:

```javascript
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
```

### Nest.js

```json
{
  "scripts": {
    "build": "nest build",
    "start": "node dist/main"
  }
}
```

### Network Connectivity

Only outbound connections on ports 80 (HTTP) and 443 (HTTPS) are allowed from the container. Connections to GoDaddy databases are also supported.

Do not rely on arbitrary outbound ports or external services reachable only on non-standard ports — those connections will be blocked at runtime. Design the app to communicate over HTTP/HTTPS only.

## Database (Managed MySQL)

Node.js Hosting includes a managed MySQL database for every app. The platform provisions the database automatically and injects connection credentials as environment variables — no manual setup required.

### Environment Variables

The following environment variables are available at runtime:

| Variable | Description |
|----------|-------------|
| `DB_HOST` | Database hostname |
| `DB_PORT` | Database port (typically 3306) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password |

These are set automatically by the platform. Do not hardcode database credentials — always read from `process.env`.

### Connecting to the Database

Install the `mysql2` driver:

```bash
npm install mysql2
```

Basic connection example:

```javascript
const mysql = require('mysql2/promise');

async function query(sql, params) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    const [rows] = await connection.execute(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}
```

### Best Practices

- **Use short-lived connections** — open a connection per request and close it in a `finally` block.
- **Use parameterized queries** — never interpolate user input directly into SQL strings.
- **Preview and publish share the same database** — both environments connect to the same MySQL instance. Plan migrations and schema changes accordingly.
- **Use an ORM if preferred** — `mysql2` works with ORMs like Prisma and Drizzle that support MySQL.

### Importing Data

You can import a `.sql` dump file (up to 100 MB) through the Node.js Hosting UI. The import replaces existing tables, so back up data if needed.

### External Databases

Only the managed MySQL database and GoDaddy-hosted databases are reachable from the container. External databases on arbitrary hosts and non-standard ports (e.g. 3306, 5432) are **not reachable** because the platform only allows outbound traffic on ports 80 (HTTP) and 443 (HTTPS). If your external database is accessible over HTTPS (e.g. PlanetScale, Neon, Turso, Supabase), store the connection URL in Secrets through the Node.js Hosting UI and access it via `process.env.YOUR_SECRET_NAME` in your code.

## Pre-Upload Checklist

Before uploading to Node.js Hosting, verify:

- [ ] `package.json` exists in the root directory
- [ ] `package.json` has a `"start"` script
- [ ] All production dependencies are in `"dependencies"` (not `"devDependencies"`)
- [ ] App listens on `process.env.PORT`
- [ ] No hardcoded ports, secrets, database credentials, or local file paths
- [ ] If using the managed database, `mysql2` is in `"dependencies"` and code reads `DB_*` env vars
- [ ] App runs locally with `npm install && npm start`
- [ ] If using a build step, `"build"` script is defined in `package.json`
- [ ] All outbound connections use HTTP (port 80) or HTTPS (port 443)

## Troubleshooting

### App won't start
- Check that `"start"` script exists in `package.json`
- Make sure the entry point file referenced in `"start"` actually exists
- Verify all dependencies are listed under `"dependencies"`

### Port errors
- Never hardcode a port number — always use `process.env.PORT`
- For frameworks that need a host, bind to `0.0.0.0` not `localhost`

### Missing modules
- Ensure all required packages are in `"dependencies"`, not `"devDependencies"`
- The platform runs `npm install --production` so dev dependencies are not installed

### Build failures
- If the app needs a build step (TypeScript, Next.js, etc.), add a `"build"` script
- Check that build output paths match what the `"start"` script expects

## Getting Help

If you run into issues deploying, reach out through the Node.js Hosting interface or contact GoDaddy support.

---

## Project-Specific Notes (DEAD's Dashboard)

This app is a **Next.js 15 (App Router)** dashboard. The notes below record how it
complies with the platform requirements above so future changes stay compliant.

### Entry point & port
- `main` / `start` → `server.js`, a custom Next.js server that listens on
  `process.env.PORT` (see Port Binding). `next start` would also work, but the
  custom server makes the PORT binding explicit and keeps `main` consistent.
- `build` → `next build`. The platform runs the build before `npm start`.

### Critical: build toolchain must live in `dependencies`
The platform installs with `npm install --production`, which **skips
`devDependencies`**. Next.js's build needs TypeScript, Tailwind, and PostCSS, so
these are deliberately kept under `dependencies` (not `devDependencies`):
`typescript`, `@types/node`, `@types/react`, `@types/react-dom`,
`tailwindcss`, `postcss`, `autoprefixer`. Moving them back to `devDependencies`
will break the production build with "Could not find a production build in the
'.next' directory."

ESLint is **not** required at build time — `next.config.ts` sets
`eslint.ignoreDuringBuilds: true`, so `eslint` / `eslint-config-next` may stay in
`devDependencies` (used only by local `npm run lint`).

### Critical: do NOT add `vitest` (or anything pulling in `esbuild`) to package.json
Deploys failed twice on `esbuild`, which `vitest` pulls in via `vite`:
1. Archive extract: `tar: can't create hardlink './node_modules/esbuild/bin/esbuild'
   to './node_modules/@esbuild/linux-x64/bin/esbuild'` — esbuild ships its binary
   as a hardlink the platform's `tar` can't recreate.
2. Fresh install: esbuild's postinstall (`node install.js` → `esbuild --version`)
   dies with `EACCES` because the platform sandbox won't execute the binary.

Fix: **`vitest` is intentionally NOT a dependency.** The test runner is invoked
on demand via `npm test` → `npx --yes vitest@^2 run`, so esbuild never enters the
installed tree (package.json *and* package-lock.json). Running tests needs network
(npx fetches vitest). Do not add `vitest`/`vite`/`esbuild` to dependencies or
devDependencies, and if you regenerate the lockfile, confirm it has zero esbuild
entries: `grep -c esbuild package-lock.json` → `0`.

The committed `.npmrc` (`omit=dev`) is kept as defense-in-depth (keeps the prod
install runtime-only) but is no longer load-bearing for the esbuild issue.

### Deploy logs: stale-`node_modules` cleanup warnings (platform-side, usually benign)
A deploy/preview build may print lines like:

```
WARN airo-sandbox: user-specified path does not exist, skipping path=/git-repo …
WARN airo-sandbox: user-specified path does not exist, skipping path=/node_modules …
rm: can't remove '/alloc/customer-app/<id>/preview/node_modules/next/dist/…': Directory not empty
```

What they are — **all platform-side, not our code**:
- The `airo-sandbox … path does not exist, skipping` lines are the deploy
  sandbox trying to bind-mount paths that aren't present at that stage. Benign
  setup noise.
- The `rm: can't remove … node_modules/next/dist/… Directory not empty` lines
  are the platform cleaning the **previous** deploy's `node_modules` before
  extracting the new one, with a shallow (busybox) `rm` that fails on a
  non-empty tree. The platform runs with `cleanAppDirBeforeExtract: false`, so a
  prior deploy's `node_modules/next/dist` lingers and the naive `rm` can't
  remove it. Same family as the esbuild-hardlink / EXDEV-rename quirks above.

Not our scripts: `build.js`/`start.js` only wipe `.next` via Node's recursive
`fs.rmSync(..., { recursive: true, force: true })` — they never shell out to the
`rm` shown here, and nothing from `node_modules/` or `.next/` is committed
(`.gitignore` covers both; `git ls-files | grep -E '^node_modules/|^\.next/'` is
empty). There is no repo-side fix because the extraction/cleanup step is fully
platform-managed (no Docker/CI config on this host).

These can be **fatal**, not just noise: when the `rm` can't clear the prior
deploy's `node_modules/next/dist`, the new archive extracts on top and you get a
half-old/half-new `next` module, which makes the platform's `next build` (or the
runtime) fail — surfacing as a generic "build failed" even though the code is
fine. Confirmed clean on our side: a fresh `npm install` under `.npmrc`'s
`omit=dev` (exactly the platform's install — no devDependencies, no esbuild)
followed by `node build.js` produces a valid `.next/BUILD_ID`. So when the
platform build fails right after these `rm` lines, the corruption is the cause,
not our code.

Remedy — force a **clean slate** so there's no stale `node_modules` to extract
over (in rough order of reliability):
1. **Delete & recreate the preview environment** (wipes
   `/alloc/customer-app/<id>/preview/` entirely) — most reliable.
2. The Node.js Hosting UI's **clean-redeploy / clear-build-cache** option, if present.
3. **GoDaddy support**: "preview deploy can't clean a stale
   `node_modules/next/dist` (Directory not empty) and the build fails — please
   clear the preview app dir." Re-pushing without clearing usually just hits the
   same un-removable stale dir again.

### Icons (`lucide-react`)
Navigation tabs, primary action buttons, and major section headers use
`lucide-react` SVG icons. The vocabulary lives in `lib/icons.tsx` (one icon per
tab via `TAB_ICONS`, plus named exports for actions/headers) — change icons
there, not at call sites, so one glyph keeps one meaning. `lucide-react` is a
**runtime `dependency`** (not dev) because `.npmrc` has `omit=dev` and the icons
render in the shipped UI. It is pure React components with no postinstall/binary,
so it does **not** add esbuild — keep `grep -c esbuild package-lock.json` at `0`.
Dense inline markers (disaster types, weather overlays, severity dots, trend
arrows, voting, affordances) deliberately stay Unicode glyphs.

**Weather condition glyphs** are the one deliberate exception that lives in its
own module: `lib/weatherIcon.tsx` maps an NWS `shortForecast` string (or an
Open-Meteo WMO code) → one lucide glyph + colour, day/night aware. PURE mappers
(`conditionIconId` / `wmoIconId`, unit-tested) + a `<WeatherIcon>` render helper;
used on the Weather-tab `LocationCard` for the current condition + the next-4
period mini-icons. Same vocabulary discipline (one condition → one glyph), same
lucide dep (esbuild stays `0`).

### The OE delta (`lib/oeDelta.ts` → `/api/oe-delta` → `OeDeltaCard` on Glance)
"What changed in the operational environment since you last looked" — the
north star's own verb, and until this nothing answered it: `warning_daily`,
`force_posture_daily` and `sitrep_status_daily` were each read only by the
feature that writes them. PURE join, no model call, one indexed query per
table, so it is cheap enough to sit at the TOP of Glance — above the morning
brief on purpose (the brief is day-cached prose; this is the live delta).
- Anchored on `surface_state`'s new **`oe`** key, bumped AFTER the delta is
  computed so this visit becomes the next baseline (bumping first would compare
  now with now). No recorded look → compares with **yesterday and says so**
  (`firstLook`) — a delta against an unstated baseline is one the user cannot
  evaluate.
- **NET change, not a log**: level at the last look vs level now, one row per
  subject. Went red and back to amber while away → no row (chronicity carries
  recurrence).
- **No baseline → no direction.** A series that began after the last look is
  reported `new` (only if elevated), never "worse" — that would be a claim
  about a past the app never observed. Same floor as `classifyChronicity`.
- **The baseline is the last OBSERVED day at or before the look** — these
  tables are written lazily, so a recording gap is not a level.
- **Improvements are first-class** (`better` bucket, same weight as `worse`) —
  the first place the app shows an OPENING (review §5.4).
- One series per SITREP **LED**, not per base: the axis is what moved.
- Per-kind ordinals (`rankFor`): posture reuses `SEVERITY_RANK`; LEDs `g<u<a<r`;
  I&W `calm<watch<warning<alert`. An unplaceable level is skipped, not guessed.

### Severity vocabulary (`lib/severity.ts`) — one home, one direction
Force-protection severity (`green | unknown | amber | red`) lives in
`lib/severity.ts` (PURE, client-safe, tested) — the same rule as `lib/icons.tsx`:
change it there, not at call sites. Before this, `SEV_RANK` was defined **six
times in two contradictory directions** (`forceProtection` higher-is-worse; the
two components rendering its output lower-is-worse). Each file was
self-consistent so nothing was visibly broken, but any comparison moved across
that boundary was silently backwards, and the two `SEV_DOT` tables even
disagreed on the colour of `unknown`.
- **Direction is HIGHER-IS-WORSE and the ordinals are load-bearing**:
  `green:0 unknown:1 amber:2 red:3`. `forceProtection` multiplies by them
  (`rank * 20`), so moving a value silently rescales every score. A test pins
  them.
- **`unknown` sits ABOVE `green`** — "UNKNOWN is not clear" as an ordering.
- **Components must use the helpers, never the numbers**: `isWorse`,
  `worseOf` (first arg wins a tie, matching the original reducer), `worstOf`
  (empty → `unknown`, never a guessed green), `byWorstFirst` (comparator;
  chain a tie-break with `||`), `asSeverity` (untrusted → never defaults to
  green). This is what removes the direction hazard, not centralising alone.
  Both components previously decoded a numeric "worst" back through a
  hardcoded `["red","amber","unknown","green"][n]` — gone; `worstOf` returns
  the level itself.
- `forceProtection.ts` re-exports the `Severity` type so existing
  `import type { Severity } from "./forceProtection"` sites keep working.
- Display tokens (`SEVERITY_DOT` hex for SVG/inline, `SEVERITY_TEXT`,
  `SEVERITY_BORDER`) live there too. COCOM labels: `AOR_LABELS` and the
  dash-for-unknown `COCOM_LABEL` are both in `lib/aor.ts`.
- **Deliberately NOT unified**: `lib/disasters.ts` (has `orange`),
  `lib/severeWeather.ts` (NWS `Extreme/Severe/Moderate/Minor`) and the
  Household wellbeing tone (`red/amber/calm`) are different vocabularies with
  different level names. Forcing them into one enum would be the opposite
  mistake.

### Weather tab cards (`LocationCard` + Open-Meteo enrichment)
The per-location cards fuse two keyless sources: **NWS** (`/api/weather/forecast`,
`/api/weather/alerts`) for the nicely-worded named periods + alerts (US-only), and
**Open-Meteo** (`lib/currentConditions.ts` → `/api/weather/current`, global) for
feels-like / humidity / wind gusts / today's high-low+precip / sunrise-sunset and
a current-conditions fallback. Because Open-Meteo is worldwide, a card shows
current conditions even OCONUS where NWS returns nothing (the card no longer goes
blank — it only shows "unavailable" when BOTH sources are empty). The alert badge
expands in-place to event/headline/window/area. `parseCurrent` is pure + unit-
tested; the fetch is best-effort/fail-safe (null → omit enrichment, never a fake
value). Pure `fetch`, no new dep (esbuild `0`).

### Glance "Global Reach Watch" (de-crowded)
The Glance card fuses six categories — **NEO/evacuation** (State Dept ordered/
authorized departure + recent Level-4), **disasters** (red/near-base/HADR≥50),
**base weather hazards** (Open-Meteo at tracked points/AMC hubs), and the three
"access" degraders read from the cached `/api/force-protection` feed (no new
fetch): **conflict** near a watched base, **GPS/EW** interference, and
**airspace/NOTAM** (runway closures + FIR overflight) — into one ranked list.
The access rows come from `FP_AXES` (one row per elevated conflict/airspace/gps
axis on a `forceWatch` entry); `REACH_CAT_ORDER`/`REACH_CAT_META` drive the chips
+ grouping. NEO scores (ordered 120 / authorized 85) outrank disasters (~≤115) and
weather (≤75), so a wave of evacuations used to evict everything else. Fix
(`GlanceTab.tsx`): each row carries a `cat` (`neo|disaster|weather`); **category
filter chips** (All/NEO/Disasters/Weather, live counts) slice the card, and in the
"All" view any category with **≥3** items collapses to one expandable summary row
(e.g. "5 ordered departures · CENTCOM ×3 · EUCOM · AFRICOM" via `aorBreakdown`),
so disasters & weather always keep slots. Same sources/scoring — presentation
only. Capped to 7 entries in "All", 10 when a chip is selected.

### Crisis map toolbar (decluttered)
The toolbar is a slim single row: **View** (preset dropdown → `viewName`), AOR
chips, **⚙ Layers (N)**, **Legend ▾**, search, Fit/↻/Full, Demand read. View,
Layers, and Legend are **floating popovers** anchored to their buttons
(`relative` wrappers + `top-full`, the toolbar row is `relative z-[20]` so they
overlay the map); an outside-`mousedown` effect closes them (wrappers
`stopPropagation`). The Layers popover holds the grouped toggles; **Mil air** and
**Rings** each get a contextual **⚙** that expands their options inline — Mil air
→ Mobility-only / Tankers (filters the ADS-B feed); Rings → airframe selector +
Max/Light payload (drives the reach-ring radius). Those four used to sit on the
bar full-time. Zero-count layer chips dim (count shown only when >0).

### Crisis tab — one AOR control + COCOM grouping
The map toolbar's AOR control is **chips** (All + the AORs present across
forces/disasters/NEO, from the un-filtered sets so the row is stable), and that
single `aorFilter` drives the **map dots, the Mobility Watch board, AND the ⚠
Watch list** together. With **All** selected, both lists organize under
**collapsible COCOM group headers** (worst-severity dot + count, worst-command
first); selecting one command narrows the whole tab to it (lists go flat).
`ForceWatchBoard` groups its `shown` by `cocom` (keeps the Bases/Countries lens);
the Watch list groups `items` by `it.aor` ("—"/Other for null). AOR chips carry
no counts (they span heterogeneous surfaces — counts live on each group header).

### Crisis watch "All disasters (N)" expander
The Crisis-map side **⚠ Watch** list is curated to mobility-significance
(`isSignificant` = red severity OR near a watched base OR `hadrScore ≥ 55`, top
events by HADR), so orange/green far-from-base events are intentionally omitted.
Because that confused "why is this on the Weather tab but not the crisis watch",
a collapsible **"All disasters (N)"** row under the Watch list reveals the FULL
AOR-filtered disaster feed — the same `getDisasters()` events the Weather tab's
Global Disaster Watch shows — each clickable to fly the map to it (`DISASTER_GLYPH`
/ `DISASTER_SEV_TEXT`). Both surfaces share one feed; only the Watch list filters.
The map dots already render every disaster with coords — it's the *list* that was
curated. Collapsed by default (`showAllDisasters`). When the feed is long (>8) the
expander gets its own **type + AOR filter chips** (multi-select type, single AOR,
cross-filtered live counts, "showing N of M" + reset) over the FULL coords feed —
independent of the map's global AOR filter, since this is the "browse everything"
surface.

### Map dep (`h3-js`)
`h3-js` is a **runtime `dependency`** used by the Crisis map (OSINT tab) to draw
GPSJam GPS-interference cells as H3 hexagons (`cellToBoundary`). It is pure JS
(emscripten `libh3-browser.js` — no `.node`, no `.wasm`, no postinstall/install
script), so it does **not** add esbuild — keep `grep -c esbuild package-lock.json`
at `0`. It must stay in `dependencies` (not dev) because `.npmrc` has `omit=dev`
and it renders in the shipped UI. The GPSJam upstream JSON key names couldn't be
confirmed from the build sandbox; `app/api/osint/gpsjam/route.ts` parses
defensively — if the GPS layer is empty in production while gpsjam.org has data,
match the real keys there.

### Docs: Compose · Split-at-headings · Templates (`lib/composeDocs.ts`)
Three synthesis-workflow features on the Docs tab, all built on **pure string
math in `lib/composeDocs.ts`** (client-imported — keep it dependency-free and
side-effect-free, same rule as `lib/airfields.ts`; unit-tested in
`tests/composeDocs.test.ts`):
- **Compose** (`ComposeModal.tsx`, opened from the sidebar bulk bar's
  "⧉ Compose"): assemble checked docs into one deliverable — reorder, toggle
  title page / ToC / link-rewrite / metadata / footnotes, preview, then
  **Save as doc** (tagged `synthesis`), **Export .md**, or **Export HTML
  notebook** (`renderNotebookHtml` — a fully self-contained dark-themed page;
  markdown→HTML via the hand-rolled `miniMarkdownToHtml`, which HTML-escapes
  BEFORE transforming, so doc content can't inject markup). `[[links]]`
  between included docs become `#sec-N` anchors; links out become numbered
  footnotes. Anchors are explicit `<a id="sec-N">` tags, not heading slugs.
- **Split at headings** (`DocSplitModal.tsx`, "✂ Split" in the editor header):
  cut one long doc into per-section docs at H1/H2/H3 (`splitAtHeadings`
  ignores headings inside code fences). The master keeps its preamble and
  becomes a `[[wiki-link]]` index (`buildMasterAfterSplit`; unchecked sections
  stay inline); children open with `← part of [[Master]]` so backlinks wire
  themselves. Before rewriting, the client POSTs
  `/api/documents/[id]/versions` → `forceSnapshotVersion` (bypasses the 5-min
  autosave throttle) so the split is always undoable via 📜 History.
- **Templates**: ordinary docs tagged `template` — no schema change. Reachable
  from the sidebar's New ▾ split-button (lists templates, "Save open doc as
  template", one-click seed of `lib/docTemplates.ts` starters) and the editor's
  `/template` slash command (picker inserts the chosen template's body at the
  cursor).
No new npm dep anywhere (esbuild stays `0`).

### Docs: typed links · aliases · unlinked mentions · hover previews
Phase 2 of the synthesis workflow (`lib/linkRelations.ts` + `lib/docMentions.ts`
— both PURE, client-imported, unit-tested):
- **Typed links**: `[[Title | relation: note]]` — relation ∈ supports/
  contradicts/extends/defines/example-of/see-also; an unknown pipe segment is
  a plain note, NEVER an error. **The relation lives in the markdown itself**
  (parsed by `extractWikiLinkRefs`) because `rebuildLinksForDoc` wipes and
  re-derives doc edges from text on every save — DB-only annotations would be
  lost. Stored in new `document_links.relation`/`note` columns (additive);
  one edge per doc pair, typed ref beats plain when both exist. The preview
  renders title + a superscript glyph chip (`RELATION_GLYPHS`/`_CLASSES`);
  Compose/miniMarkdown render just the title (metadata ≠ deliverable prose).
- **Aliases**: `documents.aliases` JSON column (additive). Editor exposes an
  "≈ alias" toggle next to tags. `[[alias]]` resolves in `rebuildLinksForDoc`
  (title match beats alias; JS-side case-insensitive matching because MySQL
  JSON functions are case-sensitive) and in `DocumentsTab.openByTitle` (via
  `/api/documents/titles`, the lightweight id+title+aliases index route).
- **Unlinked mentions** (`findUnlinkedMentions`): scans the open doc for other
  docs' titles/aliases as plain text — word-bounded, case-insensitive, skips
  existing `[[links]]` + code fences, one hit per target doc, names <3 chars
  skipped. Editor panel under backlinks: ⇄ Link (wraps the occurrence in
  `[[ ]]` — SHORT form, alias resolution maps it), Link all (applied
  bottom-up so offsets stay valid), ✕ dismiss (localStorage per doc).
- **Backlinks footer** now shows relation chip + the sentence around the link
  (`getBacklinks` → `BacklinkEntry.linkSnippet`, computed vs the target's
  title AND aliases).
- **Hover previews** (`MarkdownPreview`): hovering a wiki link shows a card —
  target title, this link's relation/note, ~40-word excerpt, tags. Module-
  level caches (5-min title index + per-doc payloads); unresolved titles say
  "click to create".
No new npm dep (esbuild stays `0`).

### Docs: collections · doc types · properties (the organizational spine)
Phase 3 of the synthesis workflow. Three additive `documents` columns:
`collection VARCHAR(64) NULL`, `doc_type VARCHAR(16) DEFAULT 'note'`,
`props JSON NULL`.
- **Collections** are a plain name column — NO join table. Rename = one
  UPDATE (`bulkSetCollection`); "delete" = docs fall back to "No collection".
  Sidebar groups client-side under collapsible headers (named A→Z, ungrouped
  last, pinned float within group; fold state in localStorage). **When no doc
  has a collection the sidebar stays the flat Pinned/other layout** — headers
  only appear once collections exist. Bulk bar "▤ Move" assigns (datalist of
  existing names; empty = clear); the editor has a per-doc picker whose
  "＋ New collection…" input creates by naming. Split children inherit the
  master's collection.
- **Doc types** (`lib/docTypes.ts`, pure): note/theorist/debate/thread/case/
  term/synthesis — one glyph + one colour each, same vocabulary discipline as
  `lib/icons.tsx`. Type badge in the editor tags row; icon on sidebar rows
  (notes stay bare); multi-select filter chips (only types that exist get a
  chip). Typed templates (`docTemplates.ts` now carries `docType` + `props`)
  pre-set both on create-from-template.
- **Properties** (`props` key:value, capped 20×40×200 via `asProps`): edited
  in a ⚙ panel in the editor header; **clicking a value filters the sidebar**
  via a `docs:search` window CustomEvent (no prop drilling). Search grammar
  (`lib/docSearch.ts`, pure, tested): `key:value` tokens split client-side —
  `course:600` → property filter (case-insensitive substring),
  `type:theorist` → type filter, remainder → server FULLTEXT. Export
  frontmatter now emits aliases/type/collection/props (omitted when empty).

### Docs: local graph · lexicon · thread timelines (the payoff layer)
Phase 4 of the synthesis workflow, built on phases 1–3:
- **Local graph** (`DocGraphModal.tsx`, "◉ Graph" in the editor header):
  `/api/documents/graph?id=&depth=1|2` walks `document_links` doc-edges both
  directions (node cap 60) → `layoutGraph` (`lib/docGraph.ts`, PURE, tested)
  places nodes on **deterministic concentric rings** — deliberately NOT
  force-directed (no dependency, no jiggle, same doc → same picture). Node
  ring colour = doc type (`DOC_TYPES[].hex` — raw hex because SVG strokes
  can't take Tailwind classes), edge colour = relation (`RELATION_HEX`),
  dashed = plain link. Click opens, double-click re-centres, ±1/±2 hops,
  labels toggle, hover shows the node's edges in the side rail.
- **Lexicon** (`LexiconPanel.tsx`, third chip on the Docs/Files toggle):
  `/api/documents/lexicon` → `getLexicon()` returns every `doc_type='term'`
  doc with a first-paragraph definition (`termDefinition`, pure, skips
  headings/lists/`← part of` breadcrumbs), link count, and **owner** —
  explicit `props.owner` wins, else the term's most-linked theorist
  neighbour. A–Z jump bar + course chips (from `props.course`).
- **Thread timelines** (`MarkdownPreview` + `parseThreadTrace` in
  `lib/threadTrace.ts`, PURE, tested): in a 🧵 thread doc, the ordered list
  under a "Trace" heading renders as a vertical timeline — numbered stops,
  clickable wiki buttons, relation chips, glosses from the "— suffix".
  Markdown unchanged (Compose/export see a plain list). Docs containing task
  checkboxes render normally — the pre/post split would break
  `data-task-line` offsets, and task toggling wins over the fancy view.
No new npm dep (esbuild stays `0`).

### Morning brief timezone (Auto-by-device, with optional pin)
The brief computes "today", schedule day-labels, and travel weather server-side
against one IANA zone. The client (`lib/briefingPrefetch.ts` +
`components/BriefingModal.tsx` — prefetch, cache-miss, and manual-refresh paths)
sends its **device** zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) as
`tz` on every `/api/briefing` POST. The route resolves the effective zone from
`prefs.timezoneMode`:
- **`"auto"` (default)** → device `tz` wins (`requestTz → prefs.timezone →
  "America/Chicago"`), so a brief opened on a phone in another zone shows that
  zone's "today" with no setup.
- **`"pinned"`** → `prefs.timezone` overrides the device (`prefs.timezone →
  requestTz → default`), a fixed reference zone for travelers.
The request zone is validity-guarded (`isValidTz`); a bogus value falls through
to the pref. The brief cache key already varies by tz, so flipping zones
regenerates rather than serving a stale day. The mode is set in Preferences →
Profile → Timezone (segmented Auto/Pin toggle; Auto shows the live device zone).
**Event timezones are always honoured**: Google returns timed events as RFC3339
with the offset baked in, so the instant is preserved and merely *formatted* in
the effective zone; all-day events are floating dates taken as-is (no tz drift).
Stored in `user_prefs.timezone_mode` (`VARCHAR(16)`, default `'auto'`).

### Database
- Uses the managed MySQL via `mysql2` (`lib/db.ts`), reading
  `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` from `process.env`.
- All 7 tables are created automatically on first connection
  (`CREATE TABLE IF NOT EXISTS`), so no manual schema import is needed.
- All queries are parameterized (`?` placeholders) — never interpolate input.

### Other env vars (set via the Node.js Hosting UI — see `.env.example`)
`NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ANTHROPIC_API_KEY`, `GMAIL_SECONDARY_REDIRECT_URI`, `OWNER_EMAIL`.

Optional feature keys (the feature is simply off when unset, never a hard error):
`AISSTREAM_API_KEY` (live maritime AIS), and ACLED credentials for the Crisis
map's structured-strike layer (`lib/acled.ts`).

ACLED credentials resolve **settings-first, env-override**:
1. **Settings** (preferred): set in Preferences → Sources & feeds → "ACLED
   Strikes". Stored in dedicated `user_prefs.acled_email` / `acled_password`
   columns — deliberately **NOT** part of the `UserPrefs` JSON blob or
   `getUserPrefs()`, so the password never rides along in the `/api/user-prefs`
   GET the browser receives, and a normal prefs Save can't clobber them. They're
   read/written only via `/api/settings/acled` (GET returns email + status, never
   the password; POST verifies then saves; DELETE clears) and the server-only
   accessors in `lib/userPrefs.ts` (`getAcledCredentials` / `saveAcledCredentials`
   / `clearAcledCredentials`).
2. **Env vars** `ACLED_EMAIL` + `ACLED_PASSWORD` OVERRIDE settings when both are
   set (the UI then shows read-only "configured via environment variable").

ACLED uses a Drupal **session-cookie login** (no API key, and NOT OAuth — the
earlier `/oauth/token` password-grant code was wrong and never returned data):
POST `{name,pass}` JSON to `acleddata.com/user/login?_format=json`, which replies
with a session cookie (`Set-Cookie`). We capture that cookie (via undici's
`getSetCookie()`) and send it as the `Cookie` header on
`acleddata.com/api/acled/read` GETs — no bearer token is passed. The session is
cached in-process (12 h; keyed by email, `resetAcledCache()` drops it when creds
change) and re-established on expiry or a 401/403 read. Reads are `limit` 300/type
— under ACLED's 5000/call cap, single page. **ACLED attribution is mandatory** —
the Crisis map renders "Armed Conflict Location &
Event Data Project (ACLED) — acleddata.com" in the sources line + popups; keep it. `lib/acled.ts` is
pure `fetch` (no new npm dep, so `grep -c esbuild package-lock.json` stays `0`).

### Multi-user (crew) — phase 1 shipped, phase 2 pending
The dashboard is now **owner + small crew**: `ALLOWED_EMAILS` (comma-separated,
case-insensitive) admits additional Google accounts alongside `OWNER_EMAIL`
(`lib/allowlist.ts`, pure + tested; checked in the NextAuth `signIn` callback).
The owner remains the admin: diag routes and team-config writes stay
OWNER_EMAIL-gated.

**Phase 1 (shipped)** — crew accounts are SAFE, not yet fully personalized:
- **Per-user personal surfaces** (privacy-leak closure): `briefing_cache`,
  `user_memory` (chat memory + pending exchanges), `surface_state`, and
  `app_ui_state` are keyed by `user_email`. Pre-split rows carry
  `user_email = ''` and are honoured as the OWNER's legacy rows — reads prefer
  the exact-email row and fall back to `''` only for the owner
  (`lib/currentUser.ts`). PK rebuilds run via `KEY_MIGRATIONS` in `lib/db.ts`
  (checked against information_schema, no-ops on fresh installs where the
  CREATE TABLE already has the composite PK).
- **Email/Calendar are inherently per-user** — the Google token lives in each
  session's JWT; the secondary-Gmail token is an httpOnly cookie (per browser).
- **`user_prefs` POST is owner-only** until phase 2: the single shared row is
  team config + the owner's personal prefs, so a crew Save would clobber both.
  Crew gets GET (tabs render off shared config).
- **Per-user AI cost attribution**: `anthropic_usage.user_email` + optional
  `user` on `logCall`; wired on the personal-spend routes (chat, briefing,
  email triage, digest, quick-capture, sitrep read, memory). Shared/background
  calls log '' and report as "shared" in the AI Controls per-user breakdown
  (`AiUsageSummary.byUser`, shown for the last 30 days once >1 identity).

**Phase 2 CORE (shipped)** — the personal/team prefs split:
- `user_personal_prefs (user_email PK, prefs JSON)` holds each crew member's
  PERSONAL overlay. The split lives in `lib/userPrefs.ts`:
  `PERSONAL_PREF_KEYS` (role, priority/deprioritize topics, watchlist, vip/mute
  senders, dismissed VIP suggestions, newsletter sources, disabled news
  sources, local area, theme, timezone+mode) + `pickPersonal` (pure, tested)
  + `sanitizeOverlay` (field-by-field validation; malformed fields DROP, never
  default — absent key = fall through to base).
- **`getUserPrefs(email?)`**: no email (background/shared contexts) or the
  OWNER → the legacy shared row as-is (it carries the owner's personal values
  from the single-user era; the owner has NO overlay row by design). Crew →
  team fields from the shared row + personal fields from APP DEFAULTS (never
  the owner's values) + their overlay.
- **POST /api/user-prefs split**: owner writes the whole shared row (as
  always); crew writes go through `savePersonalPrefs` (personal subset only —
  team fields in their payload are ignored, so a crew Save cannot clobber team
  config). Brief-cache invalidation is scoped: team edit → clear all; personal
  edit → `clearBriefingCacheFor(email)`.
- Per-user prefs are wired into the personally-sensitive routes: user-prefs
  GET/POST, briefing, chat, gmail (vip/mute), newsletters, osint feed
  (watchlist), quick-capture, digest, news-chat. News curation
  (`news_overview_cache`, PK = date) deliberately stays owner-flavored — a
  per-user ctx would make two users' caches fight over one row.

**Phase 2b (NOT built)** — per-user satellite tables, same legacy-'' pattern
as phase 1: `article_prefs` (news feedback), `newsletter_prefs`, `saved_items`,
`trips` (a crew trip currently changes the OWNER's effective location too —
known cross-user effect), `contacts`.

### Secondary Gmail account (the "Add account" OAuth flow)
The Email tab can connect a **second** Google account alongside the NextAuth
primary login. It's a hand-rolled OAuth flow (NOT NextAuth) in
`app/api/auth/gmail-secondary/` with shared helpers in `lib/secondaryOAuth.ts`
and token crypto in `lib/secondaryAuth.ts`. The encrypted token lives in an
httpOnly cookie (`secondary_gmail`), not the DB. Getting this working end-to-end
hit several non-obvious snags — record of what each requires so it isn't
rediscovered:

1. **Callback must be a clean path, no query string.**
   `redirect_uri` = `…/api/auth/gmail-secondary/callback` (its own route), NOT the
   old `…/api/auth/gmail-secondary?step=callback`. Google's authorize endpoint
   rejects some query-string redirect URIs as malformed — which renders on
   desktop as `Error 400: redirect_uri_mismatch` but on **mobile as a bare "400 …
   malformed" page** (same error, stripped rendering — don't be misled into
   thinking it's a mobile-only bug). The primary NextAuth callback works because
   it's already a clean path (`/api/auth/callback/google`).
2. **`redirect_uri` is resolved per-request, env-pinned, normalized.**
   `resolveRedirectUri()` prefers `GMAIL_SECONDARY_REDIRECT_URI` (trimmed —
   a trailing newline from the hosting env UI silently breaks Google's
   byte-for-byte match) but normalizes any value to `${origin}/…/callback`, so a
   legacy `?step=callback` env value is transparently upgraded. If unset it
   derives from the request origin (never a localhost default in prod). It is
   identical across devices, so a working desktop + failing mobile is **never** a
   redirect-URI difference — it's caching or account selection (below).
3. **Register the exact callback in Google Cloud Console** under the OAuth client
   whose ID matches `GOOGLE_CLIENT_ID` (the *same* client primary uses). Verify
   against that client ID specifically — a "duplicate not allowed" message means
   it's already there, but possibly on the wrong client or with a stray trailing
   slash/space that blocks the exact match. Changes can take minutes-to-hours to
   propagate. `GET ?step=debug` (owner-only) returns the exact `redirectUri` the
   flow will send plus `fromEnv`/`clientIdSet`/`clientSecretSet` for diffing
   against the Console without decoding a Google error page.
4. **Redirects are `no-store` + `force-dynamic`.** Without it, mobile Safari (and
   sometimes Chrome) caches the `initiate`→Google hop and replays a stale
   authorize URL. An already-cached browser still needs a one-time site-data
   clear; the headers only stop *re-*caching.
5. **`prompt: "select_account consent"`.** This is an "add a *different* account"
   flow, so `select_account` forces Google's account chooser — otherwise Google
   silently reuses the browser's active session (usually the primary), which is
   why it appeared to work only in incognito (no active session to reuse).
   `consent` stays so we always get a refresh token.
6. **OAuth consent screen / Workspace gates** (Cloud Console → OAuth consent
   screen, and admin.google.com for Workspace accounts): must be **External**
   with the connecting account listed under **Test users**; for a Workspace
   account, the org's **API controls → third-party app access** must allow it (or
   trust the client ID). Restricted scope `gmail.modify` + Testing status means
   **refresh tokens expire after 7 days** → the secondary silently disconnects
   weekly; publish the consent screen to **Production** (bypass the unverified-app
   warning for own accounts) to stop that.

Scopes requested: `gmail.modify` + `calendar.readonly`. `lib/secondaryOAuth.ts`
is `google-auth-library` + `@googleapis/gmail` only (no new esbuild —
`grep -c esbuild package-lock.json` stays `0`).

### Crisis map conflict layer (UCDP, was GDELT GEO)
The Crisis map's "Conflict" layer (`lib/conflictEvents.ts` → `/api/osint/conflict`,
shared with the AI crisis read) is sourced from **UCDP** (Uppsala Conflict Data
Program GED) — keyless, georeferenced. It **replaced GDELT's GEO 2.0 API**, which
was retired (every geo path 404s — confirmed via `/api/osint/crisis-diag`). GDELT
is NOT fully gone: its **DOC 2.0** API still powers the TDY local-news strip
(`lib/localNews.ts`), which is alive. GED row order is **arbitrary** (per UCDP's
docs), so `getConflictPoints` filters recency server-side with the **`StartDate`**
parameter (operates on `date_end`) and pages `Result[]` — it does NOT slice a
page. UCDP ships a **monthly candidate** dataset (`YY.0.M`, e.g. `26.0.4`, ~1-2mo
lag) plus a **yearly** GED (`26.1`, covers through the prior year). Candidates
increment monthly, so `ucdpVersionCandidates()` lists them newest-first (current
month down) then the yearly fallback, and `resolveVersion()` probes + caches
(24h) the first that returns rows. `diagnoseUcdp()` reports the resolved version
+ newest event date so freshness is visible. **UCDP's API now requires a token**
(returns 401 `API token required. Add header: x-ucdp-access-token:` otherwise) —
set `UCDP_API_TOKEN` in the env (`ucdpHeaders()` sends it). **Without a token the
Conflict layer falls back to keyless ReliefWeb** (`reliefWebConflictPoints` — UN
OCHA complex-emergency/conflict/insecurity situations plotted at country centroid
via `primary_country.location`; coarser than UCDP's precise events). Each
`ConflictPoint` carries `src: "ucdp" | "reliefweb"` and the route returns
`source`, so the map badge + popup attribute correctly. ACLED stays the
higher-fidelity layer, but its free tier embargoes data <12 months old (the diag
surfaces this as a `restriction`).

### Crisis map airfields (`lib/airfields.ts` + OurAirports fill)
The Crisis map's **Gateways** layer and the Demand read's access hints come from
two sources:
- `lib/airfields.ts` — curated AMC hubs + C-17/C-130 gateways. It must stay
  **pure data + math**: the haversine is **inlined**, NOT imported from
  `lib/disasters.ts`. This is load-bearing — `CrisisMap.tsx` (a client component)
  imports `GATEWAYS` from here, so re-adding the `disasters` import would drag
  `rss-parser` (and its tree) into the **client bundle**. Keep it dependency-free.
- `lib/ourAirports.ts` — the global "search others" fill. Lazily fetches +
  caches (24 h) the keyless OurAirports CSV
  (`davidmegginson.github.io/ourairports-data/airports.csv`), filtered to
  large/medium airports. Pure `fetch` + a hand CSV split (no new dep → esbuild
  stays `0`). The Demand read (`/api/crisis-read`) uses it only when no curated
  gateway is within ~600 km. Verified in prod: ~5,276 fields.

### Airfield runway capability (`lib/ourAirports.ts` + `runways.csv`)
"Can a heavy actually land here?" — `lib/ourAirports.ts` also lazily loads the
keyless `…/ourairports-data/runways.csv` (24 h cache), keeping the **longest OPEN
runway + surface** per ICAO and classing it **planning-grade**: `C-17` (≥7000 ft
hard), `C-130` (≥3500 ft), else `light` (`classify()`; thresholds are advisory,
not assault minimums). `airfieldCapabilities(idents)` + `capTag()` are the
accessors; `nearestOurAirports` carries `cap`. Surfaced in: the **AMC demand
read** access hints (`[13123ft asph · C-17]`), the **Crisis-map Gateways popups**
(via `/api/airfield-capability?icao=`), reusing the same CSV splitter (esbuild
stays `0`).

### Force Protection weather is anticipatory (TAF)
`assessWeather` scores current METAR **and** a TAF outlook: `getTafOutlook(icaos)`
(`lib/aviationWx.ts`, reuses the Weather tab's `decodeTaf`, 30 min cache) returns
the worst forecast flight category in the next ~18 h. When the forecast drops
below MVFR and worse than what's observed, the weather axis adds an amber
`TAF: IFR forecast by 14Z` signal — which flows into Ground Truth access + the
force read. `ForceContext.aviationTaf` carries it (tests set `aviationTaf: {}`).

### Crisis map reach is planning-grade + tanker filter
`AIRFRAMES` carry **light (ferry) vs max-payload** reach per type (+ C-130J); a
**Max/Light payload** toggle drives the reach rings, all relabeled "planning-grade
— no wind, AR sequencing, or diplomatic routing" so they're not mistaken for
flight planning. A **⛽ Tankers** toggle on the Mil air toolbar filters the ADS-B
layer to refuelers (`lib/aircraftTypes.isTankerType` — KC-46/135/10/30, Il-78,
A330 MRTT, KC-130).

### Crisis map INFORM Risk (`lib/inform.ts` → World Bank Data360, NOT JRC)
The **INFORM Risk** layer (structural country crisis-risk index `INFORM_OVRL`,
0-10) is sourced from the **World Bank Data360** API
(`data360api.worldbank.org/data360/data?DATABASE_ID=DRMKC_INFORM&INDICATOR=INFORM_OVRL`),
NOT the JRC site. Why: the JRC GRI API (`drmkc.jrc.ec.europa.eu`) **resets
datacenter IPs** on its data endpoint (`read ECONNRESET`) — its lightweight
`/workflows/` metadata call succeeds but the Scores call dies mid-response —
almost certainly server-side anti-scraping, not fixable from our side. Data360 is
a CDN-backed, programmatic-access host. Response is OData (`{ value: [...] }`,
rows carry `OBS_VALUE` / `TIME_PERIOD` / `REF_AREA` ISO3 / `REF_AREA_NAME`); we
keep the latest year per country and plot at `countryCentroid(REF_AREA_NAME)`
(loose name match, same as NEO advisories — only crisis-prone centroids plot).
Keyless, pure `fetch` (esbuild `0`). The data360 contract was pinned from the
official `worldbank/data360-mcp` client source.

**INFORM Severity is intentionally NOT implemented**: the Data360/JRC GRI dataset
is Risk-only (0 severity workflows), and Severity is distributed as **Excel on
HDX** — adding it would need an xlsx parser + CKAN discovery. The map has no
Severity toggle. Don't re-add one without wiring that separate source.

### Crisis map: a blank map is a bug, never a quiet world
Three separate ways the map could go empty with nothing said — all now named
on screen, because "the OSINT map isn't displaying" is indistinguishable from
"nothing is happening" to the person reading it.
- **Render exception** — the map composes ~15 feeds and React unmounts a
  throwing subtree, so one malformed row used to blank the whole panel.
  `components/ErrorBoundary.tsx` (the app's first) wraps `CrisisMap` in
  `WatchPane`: it names the failure, prints the message, and retries by
  changing the child `key` (without the key change React reuses the instances
  and re-throws on the same state). Use it for any other composite panel.
- **Refused session** — nearly every layer route gates on the Google
  `accessToken`, so an expired session 401s ALL of them at once, and each
  fetch in `CrisisMap` swallows non-ok (`r.ok ? r.json() : null`). Right for
  one flaky upstream, wrong here. `noteStatus` on the probe fetches raises a
  red "signed out — sign in again" badge, cleared at the top of each refresh
  cycle so re-login clears it.
- **Basemap refusal** — the basemap is the one layer whose failure means
  "there is no map". `lib/basemaps.ts` (PURE data, unit-tested, shared by
  `CrisisMap` and the Regional pane's `IncidentMiniMap` — one list, one fix)
  keeps **two dimensions deliberately separate**: `BasemapStyleId`
  (`dark|satellite|street`) is the user's PICK, persisted cross-device via
  `UI_KEYS.crisisBasemap`; `failedCount` is how many providers in that style's
  chain have been ruled out. Mixing them is how you lose the ability to say
  whether a wrong-looking map is a setting or an outage. A provider that logs
  `TILE_FAIL_LIMIT` tile errors *without ever loading one* is judged to be
  refusing us (ordinary coverage gaps produce errors AND loads) and the chain
  advances, showing a `basemap: <name>` badge. Changing style resets the
  judgement — carrying a previous chain's count would skip the new style's
  first provider untried.
  - Chains: **dark** Esri dark canvas → OSM-darkened · **satellite** Esri world
    imagery → Esri dark → OSM-darkened · **street** Esri street → OSM. Imagery
    degrades to *cartography*, not to a street map — a satellite style falling
    back to streets is surprising.
  - **INVARIANT (test-enforced): every chain has ≥2 entries and ENDS on
    `tile.openstreetmap.org`.** Esri leads all three (real cartography for every
    look, keyless on the legacy MapServer endpoints) but is one vendor; the last
    resort must be the host with no key concept. An earlier draft ended the
    street chain on OpenTopoMap and a test written from this comment caught it.
  - `providerFor` **clamps** rather than indexing past the end — a blank map is
    the outcome this module exists to prevent, so it can never return undefined.
  - Satellite adds `ESRI_REFERENCE_OVERLAY` (place names/boundaries) on top,
    because imagery alone has no labels. It is NOT health-checked and is dropped
    once imagery has fallen back — the cartographic tiles already have labels,
    and drawing both doubles every place name.
  - Esri URLs are `{z}/{y}/{x}` — **row before column**, unlike every other
    entry; getting it backwards yields a map that loads but is transposed.
  - Light providers carry `DARKEN_CLASS` (`.crisis-basemap-darken`, globals.css
    — invert+hue-rotate on the tile pane only; the marker panes are its
    siblings, so marker colours survive). `darken` is a property of the ENTRY,
    not the URL: plain OSM appears twice, darkened inside the dark styles and
    as-is inside street.
  - **Google Maps was considered and declined.** Pulling Google tiles into
    Leaflet (`mt1.google.com/vt/…`) breaches the Maps ToS and gets IP-blocked —
    the CARTO problem with legal exposure added. Maps Platform proper is a
    rewrite of ~55 react-leaflet elements (Google has no `CircleMarker`, no
    `Tooltip`; the radar loop becomes `ImageMapType` overlays) AND makes the
    basemap a metered dependency needing a key plus a billing account. Esri's
    keyless endpoints deliver the same dark-and-satellite look. Revisit only on
    explicit request.

  **CARTO is REMOVED, not demoted, and must not be re-added.**
  `basemaps.cartocdn.com/dark_all` was the primary for both maps. It withdrew
  keyless access and now answers with a nag TILE — an image reading "API key
  required · carto.com" — served as **HTTP 200, content-type `image/png`**.
  That is the worst failure mode a dependency can have: `tileerror` never
  fires, `load` fires happily, and nothing on the client can distinguish that
  graphic from cartography, so the map rendered as broken while reporting
  itself healthy. The `TILE_FAIL_LIMIT` detector only catches providers that
  fail HONESTLY. The generalizable rule: prefer a tile host with **no key
  concept at all** over one whose free tier is a revocable policy — OSM leads
  because it has never had keys and returns a real 403/429 when it wants us to
  stop. `map-diag` keeps a CARTO row as a deliberate **negative control**: it
  reads `status: 200` and healthy, proving a 200 from a tile host means
  nothing.

**`/api/osint/map-diag` (owner-only)** exists because none of this is
verifiable from a dev sandbox: the egress policy blocks every host the map
talks to (tile CDNs, ADS-B mirrors, RainViewer), the same wall that makes DAIP
and travel.state.gov unprobeable. It fetches all of them FROM PRODUCTION and
returns status + a 200-char body snippet per layer, plus `basemapOk` and a
`keyDemands` list that greps the bodies for key/token/unauthorized language —
which is how an upstream's "API key required" gets attributed to a service
instead of being guessed at. Real fetches, never on a page load.

### Crisis map radar (`lib/` n/a — `/api/osint/radar` + RainViewer tiles)
The optional **Radar** layer (off by default) animates RainViewer precip/
convection. Two CSP facts make it work: the app's `connect-src` (next.config.ts)
does **not** allow `api.rainviewer.com`, so the frame **index** is proxied via
`/api/osint/radar`; the **tiles** load directly from `tilecache.rainviewer.com`
because `img-src https:` allows them. Render note: the loop mounts **all frames
and animates by opacity** (the active frame opaque, the rest at 0) rather than
swapping one TileLayer's `url` — swapping `url` drops the old tiles before the
new load and **blinks**. Keyless, no new dep.

### Crisis map Overflight layer + the DAIP airspace module (`lib/airspace.ts`)
The Crisis-map **Overflight** layer (off by default) and the broader DAIP NOTAM
classes come from `lib/airspace.ts` → `/api/osint/airspace`. **Key contract fact
(confirmed by a live capture, corrects an earlier wrong handover):** DAIP serves
**every** NOTAM query class through **one endpoint** — `POST /daip/mobile/query`
with a JSON body matching its `SearchResult` model (`{type, locs, radius, sort,
acode, lat1/lng1/lat2/lng2, …}`); only the **`type`** field differs and **all**
responses share the identical `group→notams→list` envelope (so `parseDaipNotams`
/ `parseAirspaceGroups` are drop-in for every type). The SPA's `nfir`/`artcc`/
`tfa` paths are just HTML form *fragments* it `.load()`s — **`GET /daip/mobile/
nfir` is NOT a data endpoint (404s).** Confirmed working `type` values: `LOCATION`
(per-base, the original `lib/notams.ts`), `FIR_ARTCC` (enroute/overflight by FIR),
`GPS_WAAS`, `FUEL_NOTAMS`, `MOA`, `ARTCC_TFRS`, `PRESIDENTIAL_TFRS`,
`AREA_BRIEFING` (lat/long box), `EUROPEAN_RVSM`, `FDC_NOTICES`, etc. `locs` and
`locations` are interchangeable; `rawtext` is canonical; **list items carry NO
lat/long** (`mapIt` is just a flag), so map plotting is at the **group level**
(FIR/ICAO → centroid), never per-NOTAM.

- **Network door is shared** — `notams.ts` exports `fetchDaipQuery(payload)`
  (DoD-CA `https`, fail-safe `{configured,raw}`); `airspace.ts` and `getNotams`
  both use it. Production MUST keep the bundled DoD CA (`dodCaBundle()`); the
  system-CA trick is sandbox-probe-only (and the sandbox egress gateway can't even
  TLS-verify DAIP's DoD chain — probe from outside the proxy, see `daip-probe.ps1`).
- **`lib/firData.ts`** is **pure** (country→FIR ICAO + centroid, `resolveFirs()`)
  so the client component can import it without dragging `node:*` in — same rule
  as `lib/airfields.ts`. `lib/airspace.ts` is **server-only** (imports `notams.ts`).
- **Overflight layer** (`CrisisMap.tsx`): `/api/osint/airspace?layer=fir&countries=
  …` fetched for the **watched countries** (from the Forces feed), one CircleMarker
  per FIR at its centroid (size = count, colour = worst alert). `?layer=gps|fuel`
  also work but GPS/Fuel NOTAMs are **system-level / locationless** (no Q-line
  plotting yet) — served by the API but **not** map layers; surface them in a
  panel/Regional if needed. `FUEL_NOTAMS` was **count 0** at capture (plumbing OK).
- Fail-safe like `notams.ts`: `configured:false` (no CA) and `live:false` (fetch
  fail) both mean **UNKNOWN**, never a false "clear". Tested against real captured
  fixtures (`tests/fixtures/daip/`). Pure `fetch`/`https` — esbuild count stays 0.
- **In-process cache** (`cachedDaipQuery`, 10 min, keyed by type+locs e.g.
  `fir:OSTT`): the Overflight layer fans out one call PER FIR every 5-min refresh
  × user, so this is load-bearing for DAIP politeness. Only successful+configured
  results are cached (transient failures retry). `resetAirspaceCache()` clears it.

### Crisis map node flight-category rings (`/api/airfield-weather`)
CRF / hub / gateway markers carry a coloured ring = live **flight category**
(VFR green / MVFR blue / IFR red / LIFR magenta; no ring = UNKNOWN — never imply
a category we lack). This is the third leg of "is this field usable now"
alongside runway capability (OurAirports) and NOTAMs. `/api/airfield-weather?icao=`
batches METAR via `lib/aviationWx.ts getFlightCategories` (NWS AWC, keyless),
chunked to its 12-ICAO cap; `CrisisMap.tsx` fetches the union of CRF+hubs+gateways
when any node layer is on, refreshed on the 5-min cycle, and adds a `Wx:` line to
each node popup. `live:false` (AWC down) → no ring, marked in the source-down strip.

### Crisis map movement layers (Mil air ADS-B + Vessels AIS)
The Crisis map carries the live air+sea movement picture as two toggle layers,
**both off by default** (`components/osint/CrisisMap.tsx`):
- **Mil air** — `/api/osint/aircraft-mil`, a **keyless global** military ADS-B
  feed (community: airplanes.live / adsb.lol). ✈ rotated to track; a mobility-only
  filter (C-17/C-5/C-130/KC-*/A400/An/Il…); AOR filter; and an aircraft↔watch
  correlation that emphasizes aircraft near a watched country/base and shows
  "✈ N within 400 km" in the Force Protection popups. ~30 s refresh.
- **Vessels** — `/api/osint/ships` → `lib/aisStream.ts` (a long-lived server-side
  AISStream **WebSocket** bridge). ▲ rotated to heading; click for name/speed/
  course. **Radius-based (~300 km around home), NOT global** — AIS has no keyless
  global feed like ADS-B, so this is local, and it needs `AISSTREAM_API_KEY`
  (empty layer without it). ~30 s refresh.

The standalone **Aircraft and Maritime OSINT panes were retired** — both are now
layers on this map. Their `AircraftMap.tsx` / `MaritimeMap.tsx` components and the
iframe-provider lists (adsb.fi / VesselFinder / etc.) were deleted. **Don't
delete** `/api/osint/aircraft` (OpenSky) or `/api/osint/ships`: they still feed
the OSINT feed-pane "AOR contacts" strip. OSINT panes are now (post-consolidation): **Watch / Regional / Feeds / Sources** — see the consolidation note below.

### SITREP (OSINT "SITREP" sub-pane — per-base commander's report)
The squadron commander's situation report for 1-4 configured bases (KWRI is
the seeded default). Config: `user_prefs.sitrep_bases` JSON (`SitrepBase`:
icao/label/lat/lon/country/place + optional `artcc`), managed ONLY via
`/api/sitrep/bases` (GET; POST add/remove/artcc — the pane never round-trips
the whole prefs object, and the user-prefs POST **preserves** stored bases
when the field is absent so a Preferences save can't wipe them). Add resolves
ICAO curated-hubs → gateways → OurAirports (`airportByIdent`).
- **Assembler** `lib/sitrep.ts` (server-only, 10-min cache/base):
  one Promise.all over existing sources — AWC METAR raw + decoded categories
  + full TAF (`decodeTaf` periods), NWS point alerts (`aggregateThreats`),
  Open-Meteo current + 3-day outlook, DAIP LOCATION NOTAMs, OurAirports
  runway capability, `getForceProtection` for the single base (composite +
  axes), disasters ≤500 km, GDELT local news filtered by the impact
  vocabulary. **Center NOTAMs**: `base.artcc` (KWRI → ZNY) →
  `getCenterNotams()` in `lib/airspace.ts` — same `FIR_ARTCC` DAIP query +
  cache namespace as Overflight but WITHOUT the `firByCode` gate (US ARTCCs
  aren't in the overflight FIR set).
- **Pure logic** `lib/sitrepSignals.ts` (client-safe, tested): NOTAM display
  buckets (runway/navaid/hours/airspace; amber = closures/fuel-unavailable,
  `fieldClosed` on AD CLSD), `IMPACT_TERMS` news filter (word-bounded),
  `tafTimeline` (24-h category bar; TEMPO/PROB folded by worst category),
  and the wx/ops/threat LED rollups. UNKNOWN discipline everywhere: a dead
  source shows UNKNOWN with the reason, never implied-clear.
- **Commander's Read** `/api/sitrep/read` (POST {icao}): 3-bullet BLUF +
  watch items from the SAME cached payload (claude-sonnet-4-6, gated on the
  `chat` feature, cached 15 min per base+status fingerprint).
- **v2 additions**: `lib/astro.ts` (PURE NOAA-equation sun times + synodic
  moon illumination — planning-grade minute precision, tested on invariants
  not almanac values; polar day/night returns null, never fake times);
  **runway winds** — `airfieldRunways()` (ourAirports keeps per-runway end
  headings from runways.csv in the same 24-h pass) × decoded METAR wind
  (`decodeMetar` — the metar fetch is format=json now, giving windDir) →
  `runwayWinds()` in sitrepSignals (advisory chips: amber ≥20kt cross /
  ≥25 gust, red ≥30; variable wind → no rows); **fuel NOTAMs** (system
  `getFuelNotams()` filtered to the ICAO); **bird/BASH** — NOTAM category
  `bird` gets its own group + a dawn/dusk elevated-activity line derived
  from astro; **daily history** — `sitrep_status_daily` table (worst LED
  per axis per UTC day, `lib/sitrepHistory.ts`) renders a last-7-days strip
  + "worse than yesterday" markers.
- **UI** `SitrepPanel.tsx` (OSINT pane chip "SITREP"): base chips
  (double-click removes), status strip, BLUF, Weather/Ops/Threats/
  Infrastructure cards, inline ARTCC setter, and **⧉ Save to Docs** (dated
  doc tagged `sitrep` + icao). No new npm dep.
- **Infrastructure card (LIVE — contracts pinned from the 2026-07-06 prod
  run of `/api/sitrep/infra-diag`)**: `lib/infraSignals.ts` (PURE parsers,
  tested against the captured samples) + `lib/infra.ts` (server fetchers,
  fail-safe → UNKNOWN). Sources & the non-obvious contract facts:
  - **IODA** (Georgia Tech, keyless): entity code resolved via
    `/v2/entities/query` search (US bases → state region parsed from
    `base.place`, e.g. New Jersey = 4453; else country), then
    `/v2/signals/raw/{type}/{code}`. **`from`/`until` MUST be epoch
    seconds** — relative strings like `now-1d` are silently zeroed
    (`requestParameters` came back `from:0`). Model series (`*-sarima`,
    `*-norm`) are skipped; drop% = latest-vs-baseline medians per raw
    source (bgp / ping-slash24 / merit-nt / gtr). RED needs corroboration
    (2 sources ≥80% or one ≥95); single-source ≥50% is amber.
  - **FAA NAS** (`nasstatus.faa.gov/api/airport-status-information`, XML):
    one national fetch cached 5 min shared across bases; regex-parsed
    Delay_type sections (Ground_Stop_List/Ground_Delay_List/
    Airport_Closure_List/Arrival_Departure_Delay_List). FAA LIDs map to
    OurAirports via `K`+LID for the ≤250 km "nearby" call-outs; nearby
    closure/ground-stop = amber (own-field closure = red). US bases only
    (`nas: null` OCONUS).
  - **USGS gauges** (`waterservices.usgs.gov/nwis/iv`, WaterML): stage
    levels only, informational — flood POSTURE stays with the NWS alerts
    in the Weather card. `noDataValue` (-999999) → null. US only.
  - **Power/comms have NO sensor** — derived from the already-fetched
    GDELT impact news via `splitInfraNews` (the diag's fresh GDELT probe
    429'd: rate budget already spent on local news — do NOT add another
    GDELT call). News can raise the LED to amber, never red; with no
    sensor reporting the LED is UNKNOWN even if news exists.
  `status.infra` = `infraLed(internet, nas, powerNews, commsNews)`; the
  Commander's Read gets INTERNET/FAA NAS/POWER/COMMS lines and the read
  fingerprint includes the infra LED. All keyless, pure fetch (esbuild `0`).
- **v3 (all three approved options)**: (1) **multi-base LED strip** — the base
  chips became status tiles (4 LEDs + driver line + worse-than-yesterday, worst
  axis colours the border; click selects, double-click removes), fed by
  `GET /api/sitrep/summary` → `sitrepSummary(payload)` in `lib/sitrep.ts` (a
  deterministic per-base rollup over the SAME 10-min-cached assembly — no extra
  fan-out after first load; failed assembly → all-UNKNOWN stub, never a missing
  tile). (2) **Morning Brief "⚑ Base SITREP" block** — `BriefingModal` fetches
  the same summary route on open and renders bases with any amber/red (or a
  worse-than-yesterday delta) as full LED blocks; quiet bases collapse to one
  "all green" line. Deliberately NOT baked into the day-cached brief JSON —
  LEDs are fetched live at open so a cached brief never shows stale status,
  and no model tokens are spent (the `line` sentence is deterministic).
  (3) **closure-window timeline** — `closureWindows`/`windowConflicts` in
  `lib/sitrepSignals.ts` (PURE, tested): NOTAM B)/C) ISO times → 48-h bars
  (closure red / U-S amber / fuel-limited sky) grouped per asset
  (`windowLabel` extracts RWY/TWY/NAVAID/Airfield/Fuel), TAF category strip on
  the same axis, and runway-closure × forecast-IFR overlaps called out as
  conflicts. Only window-pattern NOTAMs WITH a parseable time become bars —
  everything else stays a text row (never a guessed bar); open-ended windows
  run to the horizon flagged UFN.
  **A NOTAM's B)/C) times bound how long the NOTICE is valid, NOT when the
  condition is in effect** — construction closures routinely read "SUN TUE WED
  1400-1800, MON 1400-1700" inside a two-month validity span.
  `parseNotamSchedule` / `scheduleOccurrences` (PURE, tested against the real
  A0467/26) expand a published day/hour schedule into one bar PER OCCURRENCE;
  no occurrence inside the horizon means NO bar at all (the NOTAM still shows
  in the text list). Painting the validity span instead drew a solid 48-h
  CLOSED bar and — through `deriveMissionImpact`'s `rwyClose` lookup — a
  PERMANENT single-runway CCIR + PMC for the whole two months: "colour is
  earned" broken in the direction that teaches the commander to stop believing
  the board. When day tokens are present but the times don't parse, the window
  is flagged `indeterminate`, renders as a dashed "SCHED — see NOTAM" outline
  in BOTH the pane and the HTML export, and is excluded from
  `windowConflicts` — an unknown extent cannot assert a weather overlap.
- **⇩ Export HTML (standalone shareable SITREP)**: `lib/sitrepExport.ts` →
  `renderSitrepHtml(payload, read)` — PURE client-safe string builder
  (tested) that renders the pane's current payload + BLUF into ONE
  self-contained HTML file: **zero JavaScript, zero external resources**
  (locked-down-machine friendly, prints cleanly), big "SNAPSHOT AS OF …Z —
  NOT LIVE" stamp, per-row source tags, same UNKNOWN-≠-clear discipline,
  closure timeline + TAF bar re-rendered as static divs via the same pure
  fns. ALL dynamic text HTML-escaped (`esc()`) — NOTAM/news text is external
  content. Recipients need no login/server/network. A **live** shareable
  viewer (tokenized public read-only route + polling file) was investigated
  and offered but deliberately NOT built — it punches a hole in the
  single-user auth wall; revisit only on explicit request.

### SITREP LIMFAC / Mission-Impact layer (leadership lens)
On top of the raw signals, the SITREP synthesizes a **mission-capability +
LIMFAC** picture for briefing leadership. Pure derivation in `lib/limfac.ts`
(`deriveMissionImpact(payload, manualLimfacs)`, client-safe, unit-tested):
translates the assembled signals into per-function capability (FMC/PMC/NMC/
UNKNOWN) across 7 airfield functions (launch/recovery, all-weather/night,
throughput, fuel, ARFF, C2/comms, force protection), a ranked **LIMFAC
register**, and **CCIR** flags. Discipline: CONSERVATIVE — only field-closed
and the **NAVAID×forecast-weather fusion** ("no usable precision approach in
forecast IFR" — the app already holds both inputs) auto-produce NMC; everything
else caps at PMC. A dead feed → the function is **UNKNOWN, never FMC**.
- **Commander-entered LIMFACs** (human-known: ARFF cat, MHE, manning/crew rest,
  barriers, MOG, contract fuel) live in `sitrep_limfacs` (SHARED per icao,
  attributed to `entered_by`; the whole crew maintains one list). CRUD via
  `/api/sitrep/limfac` (GET list · POST create/status · DELETE); each write
  calls `resetSitrepCache()`. `lib/limfacStore.ts` is server-only; auto LIMFACs
  are NOT stored (recomputed each assembly).
- Wired into `assembleSitrep` → `payload.mission` (derived after the payload
  exists, merging the stored manual LIMFACs). The **Commander's Read** prompt
  is reframed for leadership (mission-capability BLUF → greatest impact →
  projected recovery → **asks**, returns `{bluf,watch,asks}`); fingerprint
  includes `mission.state`.
- UI: `components/osint/SitrepMissionImpact.tsx` renders at the TOP of the pane
  (MC state → CCIR → Commander's Read → capability matrix → LIMFAC register +
  add/resolve form); the raw Weather/Ops/Threats/Infra cards remain below under
  "Supporting detail". The **Export HTML** leads with the same mission block.
  Additive — no existing SITREP feature removed. No new npm dep (esbuild `0`).

### Ground Truth (OSINT "Ground" sub-pane — per-country situation room)
A **sub-pane of OSINT** (not a top-level tab), rendered when the OSINT pane is
`"ground"` (`components/ground/GroundTruthTab.tsx`). A country rail + detail panel
("situation room") for the locations in the **Force Protection watch**.

- **Rail** is built from the *whole* watch list: watched **countries** AND the
  **countries of watched airports/bases** (grouped by country; 🛡 marks a country
  with a pinned airfield). A country watch is the primary posture; otherwise the
  worst base in that country stands in. The rail is **grouped by Combatant
  Command** (`cocomGroups`): collapsible USCENTCOM/USEUCOM/… headers carry the
  command's worst-severity dot + count, groups ordered worst-severity-first,
  countries within by severity; **COCOM filter chips** (All + per-command counts)
  narrow it. Source is the shared `/api/force-protection`
  (same feed as the Crisis Forces layer) — set the watch in Preferences → Force
  Protection (or the Crisis map).
- **Detail** composes: posture/civil/health/**access** reused from the Force
  Protection assessment the client already holds (NOT re-fetched); plus a per-
  country **dossier** (`/api/ground-truth?country=` → `lib/groundTruth.ts`):
  security incidents (ACLED/UCDP, in-country or within ~500 km of centroid) + a
  **mini-map** (`IncidentMiniMap.tsx`, Leaflet, dynamic `ssr:false`, with
  `invalidateSize` for the hidden-mount case) + local news (GDELT via
  `gdeltLocalNews`) merged with the user's **OSINT feeds filtered to country
  mentions** (`lib/rss` `fetchFeed`). Dossier cached 10 min/country.
- **Active conflict reporting banner**: the dossier's lead line (top, above the
  AI SITREP) — the country's recent news scored by `scoreConflictNews()`
  (`lib/conflictNews.ts`, the SAME signal that sets the Force-Protection dot), so
  the dossier explains *why* the posture is red. Red when an escalation phrase is
  present (airstrike/missile/invasion…), amber for lower-intensity conflict news,
  hidden when count 0. Reuses the dossier's already-merged GDELT+OSINT news (no
  new fetch); shows the freshest headline + corroboration count + click-through.
- **AI SITREP** per country: `/api/ground-truth/sitrep` (POST `{country, composite,
  drivers}`) synthesizes the client-passed posture + incidents + news +
  advisory/civil/health. **Gated on the chat AI feature**; cached 15 min; shows an
  "AI is off" message when disabled.
- **Natural disasters** in the dossier: `countryDisasters()` (pure, in
  `groundTruth.ts`) filters the shared `getDisasters()` (GDACS/USGS/ReliefWeb) to
  in-country (name match) or within ~500 km of centroid, sorted in-country-first
  then severity/HADR/proximity. Rendered as a "🌪 Natural disasters" card.
- **Public holidays** via **Nager.Date** (`lib/holidays.ts` → `date.nager.at`,
  keyless): host-nation holidays matter for crews (closed offices/customs/ports,
  reduced ramp/ATC). Kept OUT of the pure `civilCalendar.ts` (that's
  synchronous/widely-imported) — fetched server-side (cached 24 h, current + next
  year), filtered by the pure `upcomingHolidays()` (≤30 days, soonest first), and
  merged into the dossier's civil section (`CountryCivil.holidays`). Needs a
  curated name→ISO2 map (`countryIso2`); unmapped countries just omit the section.
- **State Dept advisory detail** (`lib/stateAdvisoryDetail.ts`): the per-country
  enrichment of the dossier's civil section, layered on TWO sources:
  1. **RSS** (`lib/stateAdvisories.ts` → `travel.state.gov/_res/rss/TAsTWs.xml`,
     already fetched) gives a level (1–4) + departure flags for ~190 countries in
     one keyless call — the always-on **backstop**. Risk-indicator *codes* are NOT
     in the `<category>` tags (those are Threat-Level + a State 2-letter
     Country-Tag, e.g. SY/IZ/IR — not ISO); the danger reasons live only as bolded
     text inside the description CDATA.
  2. **Destination page scrape** (`stateAdvisoryDetail.ts` → slug-based
     `…/travel-advisories/{slug}.html`, e.g. `saudi-arabia.html`) for the ONE
     country the user is viewing in Regional, where the richer signal earns a
     second fetch: overall level + **worst sub-area level** (the "risk bubble"),
     the standardized **indicator pills** ("Terrorism (T)", "Crime (C)"…), the
     one-line **guidance**, the **summary**, and the per-region **Do-Not-Travel**
     breakdown + date issued. Pure `fetch` + regex (no DOM-parser dep → esbuild
     stays `0`), 6 h cache, slug overrides for irregular names (Myanmar→burma,
     South Korea→south-korea, DRC→…), and **fail-safe**: any miss returns null and
     the dossier falls back to the RSS level — never a false "no advisory / safe".
  Wired into `getCountryDossier` (Promise.all) → `CountryCivil` (`worstAreaLevel`/
  `indicators`/`guidance`/`riskAreas`/`advisoryIssued`), rendered in the Regional
  ("Ground Truth") **⚖ Civil / political** card. The detail level/link is
  preferred; RSS supplies departure flags + the backstop level. Parser is
  unit-tested against `tests/fixtures/state/saudi-advisory.html` (sandbox can't
  reach travel.state.gov).
- **Host-nation health** (`lib/whoHealth.ts` → dossier `health` block, rendered as
  the Regional "✚ Host-nation health" card): live WHO **Disease Outbreak News**
  (from `lib/health`, matched in-country) over a structural **WHO GHO** indicator
  strip — UHC service coverage, basic drinking water %, basic sanitation %,
  malaria incidence/endemicity, DTP3 + measles (MCV2) immunization. GHO is the
  keyless **OData** API (`ghoapi.azureedge.net`, same family as INFORM Data360):
  each indicator is fetched ONCE globally and cached 24h (so after the first
  dossier load other countries are cache hits), name→ISO3 via the GHO COUNTRY
  dimension (cached 24h). Pure parsers (`parseIndicatorRows` keeps latest year +
  most-aggregate disaggregation per ISO3; `matchCountryToCode`) are unit-tested;
  posture bands (green/amber/red) are coarse planning thresholds. Malaria absence
  = non-endemic ("none"/green), not unknown. Fail-safe: unresolved → null → the
  card shows just outbreaks (or hides). Server-only; no new dep (esbuild `0`).
- No new npm dep (existing react-leaflet + server-side rss-parser + pure fetch),
  so `grep -c esbuild package-lock.json` stays `0`.

### X capture import (OSINT Social pane — the "dead-x-capture" flow)
X content enters the dashboard through a **user-side capture file, never a
server-side fetch**. Decision (twice confirmed): NO server use of the user's
X credentials and NO server scraping — X's API is paid at any usable tier,
x.com blocks datacenter IPs, and automated credential use risks the account.
The approved path: a **bookmarklet** run in the user's own logged-in browser
copies the posts currently rendered (list/bookmarks/search/profile/timeline)
into a versioned `dead-x-capture` v1 JSON download, which the user uploads on
the Social pane. Pieces:
- `tools/x-capture-bookmarklet.js` — readable, commented source (fix X DOM
  selector churn HERE), hand-minified into `lib/xBookmarklet.ts` (client-safe
  exported string; shown in a copy-button textarea, never an `<a href>` —
  React blocks `javascript:` URLs). **v2 is an accumulating collector**
  (proven necessary by the first real capture: X VIRTUALIZES its timeline —
  posts leave the DOM as they scroll off-screen, so v1's one-shot snapshot
  only ever saw ~5 posts): tap once to start → floating counter collects on
  a 500 ms interval while the user scrolls (deduped by status id, cap 200) →
  tap the counter (or the bookmark again) to download. Also strips the
  "(20) " tab-notification prefix from the source label and reads a list's
  real name from the header h2 when the title is just "List".
- `lib/xImport.ts` — PURE parser/validator (client-safe, unit-tested): format/
  version gate, 200-post + 1000-char caps, only `https` x.com/twitter.com
  status permalinks survive (`sanitizeXUrl` — a crafted file can't smuggle
  arbitrary links), "1.2K"-style metric strings parsed, stable ids (explicit →
  from URL → djb2 hash of handle+text) so re-imports are idempotent.
- `lib/xStore.ts` (server-only) + `x_items` table (post id PK): upsert keyed
  by id, rolling prune (14 days by import time / newest 1000), 60 s in-process
  read cache so the 90 s feed poll doesn't hammer MySQL.
- `POST /api/osint/x-import` (validate+upsert; GET status; DELETE clear) and a
  merge in `/api/osint/feed`: imported posts become kind `social`, feedLabel
  `𝕏 {source.label}` — riding existing clustering/watchlist/triage/trends with
  zero special-casing downstream. The feed route's empty-feeds early-return
  now also checks the X store.
- UI: `components/osint/XImportCard.tsx` on the Social pane (drag-drop + file
  picker, status/source chips, bookmarklet installer, Clear).
Phase 2 (pending real captures): selector fixes against saved x.com HTML the
user uploads — same capture-then-build pattern as DAIP/state.gov. No new npm
dep anywhere (esbuild stays `0`).

**Reader / event capture (generalized browser-capture, same extension).** The
`tools/x-auto-capture/` extension now captures three kinds, all in the user's own
browser (the only place with the session + residential IP):
- **X posts** (the scheduled list sweep, above).
- **Analysis articles** — toolbar-icon click = "capture THIS article" (WSJ/FP/
  Economist etc. the user subscribes to; `article.js` Readability-lite extractor
  → `dead-article` → `/api/capture/article` → `captured_articles`). PURE parser
  `lib/articleCapture.ts` (tested) + `lib/articleStore.ts`. Manual, one-article-
  at-a-time (personal-use, respects paywalled-DB terms — NOT a harvester). WIRED
  INTO I&W corroboration (`gatherUserSourceNews`, 2000-char body slice, source
  "📄") — curated analysis strengthens the escalation/Hormuz indicators.
- **LiveUAMap events** — region maps (iran/israelpalestine/syria/yemen/isis/
  emirates .liveuamap.com) are PUBLIC but block datacenter IPs, so the app can't
  fetch their RSS server-side (403 confirmed). Captured in-browser: `liveuamap.js`
  keys off the event-permalink pattern (`/en/20YY/…`, robust to class churn),
  auto-scrolls the feed → `dead-events` → `/api/capture/events` → `captured_events`
  (14d/1000 rolling). PURE parser `lib/eventCapture.ts` (tested) + `lib/eventStore.ts`.
  The scheduled sweep auto-routes targets by host (x.com → posts, liveuamap.com →
  events). Merged into the OSINT feed (kind "news", label "🗺 region"). DELIBERATELY
  NOT wired into I&W corroboration — LiveUAMap is a firehose of ALL AOR events and
  would re-pin the escalation indicator (the saturation problem `warningRules`
  fixed); revisit only with a strict recency+escalation gate.

All three ingests accept the same per-user bearer token as x-import. No new npm
dep (esbuild stays 0).

**Unattended auto-capture** (`tools/x-auto-capture/`, a Chrome/Edge MV3
extension): the same capture, on a daily `chrome.alarms` schedule, still IN THE
USER'S OWN LOGGED-IN BROWSER — decision unchanged (no server-side X access; the
runner must hold the user's session + residential IP, which Claude/Cowork's cloud
can't). `collector.js` is the bookmarklet logic adapted to auto-scroll and
RETURN the `dead-x-capture` object (injected via `chrome.scripting.executeScript`
`func`, so it must stay self-contained); `background.js` opens a background x.com
tab, injects it, then POSTs to `/api/osint/x-import`. Unattended upload is
authorized by a **per-user bearer token** (NOT a session): `x_upload_tokens`
table stores only the **SHA-256 hash** (plaintext shown once, same discipline as
ACLED creds), managed via `/api/settings/x-token` (GET status · POST generate/
rotate · DELETE revoke) and the `lib/xUploadToken.ts` accessors; the x-import
POST accepts `Authorization: Bearer xcap_…` as an alternative to the interactive
session (the manual Social-pane upload is untouched). UI to generate/copy/revoke
the token lives in the Social pane's `XImportCard` "Auto-capture" panel. Scheduling
only fires while the browser is open (`chrome.alarms` reality); a machine-cron
Playwright-against-your-own-profile variant was offered for always-on. Extension
files are static under `tools/` — outside the Next build, no esbuild.

### Strategic Economics tab (the retooled "Markets" → label "Economy")
The old **Markets** tab (TradingView ticker/overview/econ-calendar + DoD contracts)
was **retooled**, NOT retired, into a mobility-economics board: *global economic
trends affecting **access, basing, and overflight***. The TradingView widgets +
`ContractsPanel`/`/api/markets/contracts` were deleted. New pieces (all keyless):
- `lib/energyPrices.ts` → `/api/markets/energy`: Brent/WTI/natgas/gold via **Yahoo
  Finance** keyless v8 chart API (`query1.finance.yahoo.com/v8/finance/chart/CL=F`
  etc., one call/symbol, 15 min cache). Brent (`BZ=F`) = the jet-fuel/sustainment-
  cost driver. **Stooq was dropped** — it now 404s in the browser and 403s
  server-side (blocks datacenter IPs / bot UAs), so the panel showed all dashes;
  its daily CSV (`q/d/l/?i=d`) survives only as a best-effort fallback. Both are
  fetched with a **browser User-Agent** (the old bot UA was a 403 trigger). Pure
  parsers (`parseYahooChart`/`parseDailyClose`) are unit-tested; `?debug=1`
  (owner-only, `OWNER_EMAIL`) returns per-symbol per-source HTTP status so a blank
  panel shows its real cause. `EnergyQuote` carries `link` (clickable Yahoo quote
  page) + `source`. Fail-safe: unresolved symbol → null → "—", never a fake price.
- `lib/chokepoints.ts`: curated strategic chokepoints (Hormuz, Bab-el-Mandeb, Suez,
  Turkish Straits, Malacca, Taiwan, Panama, Russian overflight) + `scoreChokepoints`
  — a **pure** scorer over the day's news (no new feed). Safe to import client-side.
- `/api/markets/brief` reframed from a generic macro brief to an **Economic Access
  Read** (same `markets_brief` AI gate): fed real energy prices + chokepoint news
  signals + the user's watched countries, it reads fuel cost, sanctions/export
  controls, host-nation stress, and transit/overflight risk. Output shape changed
  (`accessRead`/`fuelLogistics`/`chokepoints`/`basingOverflight`/`watchItems`).
- UI (`MarketsTab` + `EconomicAccessPanel`): energy strip, the AI read, a
  chokepoint watch, and a sanctions/overflight/basing news filter. No new dep.

### Indications & Warning (OSINT "I&W" sub-pane — the sensor→fusion→display spine)
A doctrine-grounded I&W board: warning is about **anomaly & trajectory, not
level** (Grabo). Color is EARNED by the anomaly crossing a pre-registered
threshold — calm by default (anti-"Christmas tree"). It is ONE pipeline
(sensors → scoring → display), not two features; the airlift-demand divergence is
the marquee sensor, not a peer board.
- **Pure engine** `lib/warning.ts` (client-safe, tested): common
  `IndicatorObservation` format → weight-of-evidence `rawScore` → **anomaly =
  rawScore − baseline** (the hero number) → `levelFor` (calm/watch/warning/alert;
  **learning-mode caps at watch** until a real baseline exists, §9.4) +
  `trajectoryFor` + **drivers[]** (top 2-3 movers — the board proposes, the
  analyst disposes; a score with no visible drivers is not shippable). Sensor-
  agnostic: adding a sensor never touches scoring.
- **Taxonomy / provenance register** `lib/warningTaxonomy.ts` (pure data): the
  first watch problem is **CENTCOM · Iran** — 6 indicators (conflict intensity,
  escalatory strike/rhetoric, **airlift mobility divergence**, NEO/departure
  posture, airspace/GPS, Hormuz interdiction). EVERY indicator carries a
  pre-registered **falsifier** and **open-doctrine provenance** (ISW/CSIS/RAND/
  Grabo) + the required **decision-linkage**. Deliberately built from OPEN sources
  — the *structure* of the board, not just the data, is the classification concern
  (§6.1); the dashboard being auth-gated (allowlist) lowers but doesn't remove it.
- **Sensors** `lib/warningSensors.ts` (server-only): normalize feeds THIS REPO
  ALREADY HAS into observations — `conflictEvents`, `conflictNews`/`localNews`
  (GDELT DOC), keyless community mil ADS-B (airplanes.live/adsb.lol, mobility/
  tanker filter × implied-demand → the **divergence** off-diagonal), State Dept
  advisories, DAIP FIR NOTAMs, disasters. Every feed is `withTimeout`-bounded (the
  SITREP-read 502 lesson — a slow feed degrades to "unreachable", never a hang);
  UNKNOWN ≠ clear (unreachable sensor → dormant + flagged in `sensorHealth`).
- **User-source corroboration** (`gatherUserSourceNews`): the escalation + Hormuz
  indicators also read the user's OWN curated sources — imported **X** captures
  (`getXItems`), **newsletters** (`getAllCachedSummaries`), and configured **OSINT
  RSS/Telegram feeds** (`fetchFeed` over `prefs.osintFeeds`) — AOR-mention-gated
  and scored with the same `scoreConflictNews` vocabulary. Anti-noise discipline:
  wire+own-source agreement → **confirmed**; GDELT alone follows its own scale;
  **own-source-ONLY (e.g. a single X post) caps at WATCH** — social raises
  confidence and can trip a watch, never alone confirms. Provenance names which of
  your sources corroborated. Bounded + fail-safe (no new dep; esbuild `0`). NOT
  wired: the configured News-tab RSS sites (redundant with the GDELT base for now).
- **Calibration rules** `lib/warningRules.ts` (PURE, tested): the tunable
  judgments live here, not inline in the sensors. The through-line: **both halves
  of every signal must be baseline- or recency-relative — a permanent condition
  is posture, not warning.** Concretely: (a) Level-4 advisories only signal when
  **NEW** (14-day pubDate gate, same as Glance) — Iran/Iraq/Syria/Yemen are
  permanently L4 and used to pin the NEO indicator + `impliedHigh` true forever;
  (b) conflict intensity bands on a **trailing-90-day** slice (undated ReliefWeb
  situations count as current; 90d not 30d because UCDP candidates lag 1-2mo) —
  the feed's 365-day window saturated the bands; (c) mobility "surge" =
  today's count > **this AOR's own trailing mean ×1.4** (floor mean+2), with a
  deliberately HIGH static fallback (25) while that baseline is forming — Gulf
  hubs always have >4 mobility aircraft, so the old static ≥4 read "surge" on
  ordinary days and pinned the divergence 2×2.
- **Store** `lib/warningStore.ts` + `warning_daily` table (additive): one daily
  rollup row per problem; **baseline = trailing-mean raw_score over prior days**,
  same lazy day-rollup pattern as `sitrep_status_daily`. `mobility_count` column
  (additive migration) keeps the **day-peak** observed mobility count
  (`GREATEST` on dup) → `getMobilityBaseline` feeds rule (c); a dead ADS-B feed
  records NULL, never a fake 0. NO GitHub-Actions cron
  and NO in-repo JSON snapshots (both fight the GoDaddy deploy model) — ingestion
  is lazy-on-request. Cold start: baseline needs ~14 daily samples before it
  trusts itself (learning mode until then).
- **Assembler** `lib/warningAssess.ts` (server-only, 10-min cache) →
  `/api/warning` GET → **`WarningBoard.tsx`** (OSINT pane chip "I&W"). App-native
  slate/amber/red palette, **red reserved strictly for ALERT**. Unofficial-posture
  + ACLED/source attribution footer. No new npm dep (esbuild stays `0`).
- **NOT built (later phases):** additional watch problems; ACLED (uses the
  existing cookie-login lib, NOT OAuth) / OpenSky corroboration / gpsjam cell
  density as first-class sensors; analyst annotation / decision-log surface.

### Network
All outbound calls are HTTPS (443): Anthropic, Google APIs, RSS feeds, Twitter/X
embeds, GDELT (DOC, local news), U.S. State Dept (`travel.state.gov` — the
`TAsTWs.xml` advisory RSS + the per-country `destination/{slug}.html` pages),
UCDP (`ucdpapi.pcr.uu.se`), ACLED
(`acleddata.com`), OurAirports (`davidmegginson.github.io`, airports + runways),
INFORM Risk (`data360api.worldbank.org`), WHO (`who.int` Disease Outbreak News +
`ghoapi.azureedge.net` Global Health Observatory), RainViewer (`api.rainviewer.com` index +
`tilecache.rainviewer.com` tiles), military ADS-B (airplanes.live / adsb.lol),
OpenSky (`opensky-network.org`), NWS Aviation Weather (`aviationweather.gov`,
METAR + TAF; also the node flight-category rings via `/api/airfield-weather`),
Yahoo Finance (`query1.finance.yahoo.com`, energy/commodity quotes; Stooq
`stooq.com` is a best-effort fallback only), Nager.Date
(`date.nager.at`, public holidays), IODA
(`api.ioda.inetintel.cc.gatech.edu`, internet connectivity signals), USGS
water services (`waterservices.usgs.gov`, gauge stages), FAA NAS status
(`nasstatus.faa.gov`, ATC programs XML), and DoD DAIP (`www.daip.jcs.mil`, NOTAMs —
needs the bundled DoD CA). The one
**WebSocket** is the AISStream vessel bridge (`wss://stream.aisstream.io`, over
443). The only non-HTTP connection is to the platform's managed MySQL, which is
explicitly allowed.

### Mission Profile (the configuration spine — declare the AO, derive the tracking)
The app's settings converge on **Preferences → Mission Profile**: the user
declares hub+spoke airfields, theaters, and named AOIs; `deriveTracking()`
(`lib/missionProfile.ts` — PURE, client-safe, unit-tested) turns that into the
tracking lists every feature already reads; `applyMissionProfile()`
(`lib/missionProfileApply.ts`, server-only, `/api/mission-profile` POST,
owner-gated) MATERIALIZES them into `user_prefs`. Architecture is
**derive-and-materialize, NOT a storage rewrite** — zero downstream consumers
changed; derived rows carry `mp-*` ids (`AUTO` badges in the Mobility Watch
editors).

Load-bearing contracts (violating these re-opens closed bugs):
- **One channel per concept**: airfields → `forceLocations` + `metarStations` +
  `sitrepBases`; AOI countries → `countriesOfInterest`; chokepoints → watchlist
  terms; primary AOIs → I&W boards. Airfields are deliberately NEVER
  materialized into `trackedLocations` (civil places only) — doing so
  double-marked the Crisis map, made blank OCONUS forecast cards, and
  double-counted bases in the brief. `applyMissionProfile` purges legacy
  `mp-w-*` rows.
- **Deletions stick / manual wins**: exclusion drift compares
  `materializedIds` against what's present; id-less lists use pseudo-ids
  (`mp-m-<ICAO>`, `mp-t-<slug>`). Manual rows win natural-key collisions.
  SITREP picks initialize from the LIVE base set (never auto-default to
  candidates) so Apply can't silently replace the pane-curated set.
- **`prefs.missionSummary`** is COMPUTED read-only by `getUserPrefs` from the
  `mission_profile` column (`missionSummaryLine()`) and appended by
  `buildUserContext` — every AI route gets the declared AO. `saveUserPrefs`
  never writes it.
- Spokes/hub are stored RESOLVED (label+coords via `/api/airfields/resolve`,
  which wraps the shared `lib/resolveAirfield.ts` — same door as SITREP base
  add) so derivation stays pure client-side.
- I&W: `lib/warningProblems.ts` instantiates one templated six-indicator board
  per primary AOI (`problemFromSeed` in `warningTaxonomy.ts`; sensors take a
  `ProblemGeo` — CENTCOM_GEO keeps the legacy hand-tuned Gulf values AND the
  legacy indicator ids for history continuity). Fallback = CENTCOM_IRAN when
  no profile boards exist. Fresh problem ids start in learning mode (empty
  `warning_daily` history) by design.
- Two "home" concepts are DISTINCT on purpose: Home Location (You group,
  residence — forecast/local news/map center) vs the Mission Profile hub
  (own-force airfield — posture/METAR/SITREP). Both editors state this.

### Alerting (`/api/alerts/check` + the capture extension)
Out-of-app alerting with no cron/no push infra: the endpoint returns CURRENT
alert-worthy conditions with **stable ids** (force-protection RED,
life-threatening weather at tracked points, in-effect ordered departures, I&W
warning/alert) — callers dedupe by id, so the server keeps no per-client
watermark. Auth: session OR the capture bearer token. The extension
(`tools/x-auto-capture/background.js`) polls on a `chrome.alarms` cadence
(default 15 min, options-configurable) and raises OS notifications; seen-ids in
`chrome.storage.local`. Transport-agnostic — a future PWA/web-push pass reuses
the endpoint unchanged.

### ⌘K command palette (`lib/commandPalette.ts` · `components/CommandPalette.tsx`)
⌘K / Ctrl+K (was quick capture — capture is now an entry INSIDE it) opens a
palette from which every surface is reachable by name: tabs, the four OSINT
panes, SITREP bases, I&W boards, Regional countries, family members, docs,
Preferences sections, and the actions (brief, digest, capture, assistant,
push-alert setup) + "Search docs for …" as a trailing full-text fallback.
Ranking is PURE + tested (`rankCommands`: every token must match — AND;
exact label > prefix > word-start > mid-word > scattered subsequence; an
exact multi-word label beats a keyword hit; keywords weigh 0.7, hints 0.8).
Entity lists come from endpoints that already exist (`/documents/titles`,
`/sitrep/bases`, `/warning`, `/force-protection`, `/family/roster` — 403 for
crew is silently absent), fetched on FIRST OPEN and refreshed after 5 min —
never on page load, no model call. Selection dispatches window events; the
palette holds no tab state. **Door-in events added for it** (keep them when
refactoring a tab): `docs:open` (id, DocumentsTab), `watch:focus`
({kind:"sitrep"|"iw", id}, WatchPane — registered regardless of `armed`),
`regional:select` (country, GroundTruthTab — parked in a ref until the rail
has the country, so the default-select can't overwrite it), `family:focus`
(person id; FamilyTab mounts on open, so the palette ALSO parks the id in
`sessionStorage["family.focus"]` which the tab consumes on mount),
`prefs:open` (group key → TabShell opens the drawer then fires
`prefs:focus-group`, which PreferencesDrawer answers with `openAndScrollTo`),
`capture:open` / `brief:open` / `digest:open` (TabShell), and the existing
`app:navigate` / `osint:set-pane` / `docs:search` / `assistant:open`.
Header gets a ⌕ ⌘K button; the phone drawer gets a full-width "Go to…".

### Installable app + web push (`lib/alerts.ts` · `lib/pushDispatch.ts` · `public/sw.js`)
The alert computation was lifted out of the route into **`lib/alerts.ts`**
(`computeAlerts()`, 5-min cache, same four predicates) so the push dispatcher
reads it without an HTTP hop. **How pushes fire — there is no cron on this
host**: every `/api/alerts/check` hit ALSO runs `dispatchPush()` (rate-limited
to one pass per 4 min), which compares the current list against EVERY
subscription's own `seen_ids` watermark (`push_subscriptions` table; the
server keeps no global one) and sends the difference as ONE notification per
device (`lib/pushSelect.ts`, PURE, tested: never re-notify an id still in
effect, forget it once it clears so its return is news, cap the set). What
drives those hits: the capture extension's poll, an open dashboard tab
(`components/AlertHeartbeat.tsx` — 10-min, visible-only, armed only when the
account has ≥1 push device), and an installed Chromium PWA's `periodicsync`.
If nothing polls, nothing is sent — the setup card says so.
- `public/sw.js` handles **push + notificationclick + periodicsync ONLY — no
  fetch handler, no caching.** A stale dashboard that looks current is worse
  than a login page; do not add offline caching.
- `public/manifest.webmanifest` + `icon-192/512/512-maskable/apple-touch-icon/
  badge-96.png` (rendered from `app/icon.svg` by headless Chromium; re-render
  if the SVG changes) + `app/layout.tsx` metadata (`manifest`, `appleWebApp`,
  `icons`). iOS only permits web push from a Home-Screen-installed page.
- VAPID keys from env (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`,
  `.env.example`; generate with `npx web-push generate-vapid-keys`). Unset →
  feature off, `/api/push/subscribe` GET reports `configured:false`.
- `/api/push/subscribe` GET (configured + public key + device count) · POST
  (store this browser's subscription under the signed-in user, optional test
  push) · DELETE. Per-user — crew get their own devices' alerts. 404/410 from
  the push service drops the row.
- UI: `components/preferences/PushSetupCard.tsx` under Watchlist in
  Preferences → Profile. State is read from the browser each time (permission
  + existing subscription), never assumed from localStorage.
- `web-push` is a **runtime `dependency`** (pure JS: asn1.js/http_ece/jws —
  no postinstall, no native build; the lockfile's three `hasInstallScript`
  entries are the pre-existing fsevents/sharp/unrs-resolver). esbuild stays `0`.

### Morning Brief cross-device cache
`briefing_cache` PK is **(date, user_email, tz)** — zone-briefs coexist per
day, so devices in different timezones (Auto mode, traveling) don't ping-pong
regenerate. Reads are tz-scoped; `generatedAtMs`/`generatedTz` are baked INTO
the cached briefing object so every path shows "generated H:MM · Zone". The
"Your day" block (tasks + keep-in-touch) and Base SITREP LEDs are fetched live
at modal open, deliberately never baked into the cached AI text.
KEY_MIGRATIONS entries carry a per-entry marker `column` (the runner checks
`pkIncludes(table, column)`).

### README screenshots (`docs/` + `docs/mockups/`)
The README hero/feature PNGs are **illustrative renders** built from mockup
HTML in `docs/mockups/` (same design tokens as the app; the README says so).
Regenerate after UI changes with `sh docs/mockups/render.sh` (needs Chromium;
`CHROME=<path>` override). Keep shots in sync when a pictured surface changes
materially. No Playwright/npm involved — plain headless-Chromium screenshots.

### OSINT tab consolidation (9 chips → Watch / Regional / Feeds / Sources)
`OSINTTab.tsx` pane model: `"watch" | "regional" | "feeds" | "sources"` plus a
`feedKind` subfilter (`all|social|telegram|news` — the old four feed "panes"
were always ONE list with a client filter; they are chips INSIDE Feeds now).
- **Watch** (`WatchPane.tsx`, default pane) = I&W strip (one card per warning
  problem, `/api/warning`, 10-min poll; full `WarningBoard` expands inline) →
  SITREP LED strip (`/api/sitrep/summary`, 5-min poll; full `SitrepPanel`
  expands inline via its `focusIcao` prop) → `CrisisMap`. The pane is
  **hidden-mounted** in OSINTTab (CSS `hidden`, not conditional render) so
  pane-hopping doesn't unmount the map and re-fire its ~15 source fetches;
  WatchPane arms itself lazily on first activation (all tabs mount at app
  load — the map must not fetch before OSINT is first opened), and OSINTTab
  dispatches a window `resize` on reveal because Leaflet measures a hidden
  container as 0×0.
- **Regional** = `GroundTruthTab`, rail grouped by the DECLARATION: Mission
  Profile AOIs first (declaration order, headers carry the AOI's I&W level
  from `/api/warning` via problem id `mp-<aoi.id>`), then Own force (hub/spoke
  countries), then leftover countries by COCOM. Filter chips carry group keys.
- Deep-link compat: `osint:set-pane` accepts BOTH the new ids and every legacy
  id (`crisis`/`sitrep`/`iw` → watch; `ground` → regional;
  `all`/`social`/`telegram`/`news` → feeds + feedKind). Glance dispatchers
  unchanged.

### AI spend discipline (what may call the model, and when)
An August 2026 spend audit found the ledger healthy ($1.73/day) but two
structural leaks worth keeping closed. The rules that came out of it:

- **Nothing pays on page load.** The Threads analysis (Opus over ~40 articles,
  ~$0.42/call — the single most expensive call in the app) used to pre-fetch in
  the background from `NewsShell` the moment articles arrived, so every load or
  reload of the dashboard spent Opus tokens on an analysis nobody had opened.
  It now runs when the **Threads view is actually open** (an effect keyed on
  `viewMode`, which also covers Refresh-while-on-the-view). Same rule as
  `crisis-read` / `force-read`, which have always been click handlers.
- **`/api/threads` is day-cached like the briefing.** `thread_sessions.article_hash`
  (additive column) stores a hash of the article ids + user context;
  `getTodaySession(hash)` replays the stored session when the set is unchanged,
  so switching views repeatedly is free and only a genuinely moved feed pays.
  `?refresh=1` forces a fresh read (the "↻ Regenerate" affordance). The 15 s
  rate limit moved to AFTER the cache check — a free replay must never 429.
- **Background tabs don't poll paid surfaces.** The OSINT feed poll is gated on
  the tab being `active` AND `document.visibilityState === "visible"`, because
  every feed refresh re-runs the triage effect, which costs tokens on any item
  it hasn't classified. Triage itself is `active`-gated too. A hidden tab stops
  entirely and catches up via the focus/visibilitychange handler.
- **Every model call is attributed.** All 22 `logCall` sites now pass
  `user: normEmail(session.user?.email)`. Before this, ~85% of 30-day spend
  logged as `shared`, which made "who spent this" unanswerable. Keep the field
  on any new call site — the AI Controls per-user breakdown is the forensic
  tool, and it's only as good as its coverage.
- **The ledger is the source of truth.** `anthropic_usage` records route, model,
  tokens, and cost for every call; Preferences → AI Controls → "Show today's
  breakdown" reads it. If that total ever diverges materially from the Anthropic
  Console, the key is being used outside this app — rotate it. Route names that
  don't match an `AiFeature` key need a `ROUTE_LABEL_OVERRIDES` entry or they
  render as raw slugs in that breakdown.

### Family tab (school + household — "never miss something important")
A top-level tab whose unit is the **deadline, not the email**. An inbox
already shows unread mail; what it cannot show is that a school's exclusion
notice was one sentence inside a newsletter about spirit week. Pieces:

- **The roster is the query.** `lib/familyProfile.ts` (PURE, client-safe,
  tested) holds people + watched senders; `gmailQueryFor()` turns them into
  `from:(...) newer_than:14d`. An empty roster reads NOTHING — scoping the
  Gmail search (rather than fetching all mail and classifying) is what keeps
  the feature cheap and stops it touching mail the user never named. A bare
  domain matches at and below itself (`oakwood.org` also catches
  `mail.oakwood.org`); an address pattern matches only that mailbox.
- **Stored in its own column.** `user_prefs.family_profile` (additive), via
  `lib/familyStore.ts` + `/api/family/roster` — deliberately NOT in the
  UserPrefs JSON blob, same discipline as ACLED creds and `sitrep_bases`: a
  Preferences save must not clobber it, and it must not ride along in the
  `/api/user-prefs` GET every tab makes. It names the user's children and
  their schools, the most sensitive data in the app.
- **One model call** (`lib/family.ts`, sonnet, 15-min cache keyed on message
  ids + roster) returns deadlines, per-person summaries, the household
  paragraph and the extracted dates together — three views of one reading
  pass; splitting them would triple cost for no extra signal. Deadlines carry
  `buried: true` when the obligation sat inside a longer newsletter, and the
  UI says so out loud.
- **NEVER a guessed date** (`lib/familyDates.ts`, PURE, tested) — the closure
  timeline's rule applied to email. The prompt forbids resolving "next
  Friday"/"the 15th"; anything unanchored comes back `needsConfirm` and the
  UI offers "open the email", not "add". `normalizeProposed` also unanchors an
  absurd date (>400d out) and flags a relative phrase EVEN IF the model also
  supplied a date — in that case the date IS the guess.
- **The write boundary re-checks.** `/api/family/event` refuses any payload
  whose `startISO` is not explicitly anchored (422). The guard must hold at
  the server, not just in the UI. Nothing else in the feature writes; this
  route is the human's tap. Uses the existing `calendar.events` scope and
  `createEvent` — no re-consent needed.
- **Mounted only when opened** in `TabShell` (conditional render, NOT the
  hidden-mount used for OSINT): the digest reads Gmail and calls the model, so
  an always-mounted pane would spend on every app load. Same rule as the
  Threads pre-fetch removal.
- Gated on the `family_digest` AI feature. A model failure returns the
  coverage line with empty summaries — the tab says the summary is
  unavailable rather than implying a quiet week.
- Mockup: `docs/mockups/family.html` → `docs/family.png`.

### Family → Household pane (bills, documents, wellbeing)
A second pane inside the Family tab, organised around one claim: **the things
that hurt you are the ones with no alarm attached.** Autopay reminds itself, a
manual bill does not; a subscription renews silently; a passport expires with
no notice; and a bill that STOPS arriving raises nothing at all.

- **Division of labour is the load-bearing decision.** The model extracts
  FACTS from bill text (amount in cents, printed due date, account tail, a
  one-clause note the statement itself gives). Every JUDGEMENT — late,
  unusual, how much runway — is computed in `lib/householdSignals.ts` (PURE,
  tested). Cadence arithmetic must not be asked of a model that will
  occasionally be confidently wrong, and the silence watch in particular
  ACCUSES a biller of not writing, so it has to be right.
- **Silence watch needs memory**, which a single fetch cannot provide, so
  `household_bills` (message_id PK → idempotent re-reads) records every
  sighting. `silenceWatch()` requires **three** prior sightings before it will
  claim anything: with fewer, "quarterly" and "stopped six months ago" are
  indistinguishable. Irregular billers never appear — no expected cadence, no
  violation. Slack is generous (10/21/45 days) because one late statement is
  normal and a false alarm teaches the user to ignore the panel.
- **`amountDelta` returns null below three prior samples** — the learning-mode
  rule from I&W. A "+300%" from one prior month is noise dressed as a finding.
  `AMOUNT_ALERT_PCT` (15%) keeps seasonal swing quiet. Extracted amounts are
  range-guarded (<$100k) so one bad parse can't poison the trailing average.
- **Documents are DECLARED, not extracted** (`family_profile.documents`) — a
  passport expiry never arrives by email, so there is nothing to read and
  inferring one would invent a date. `leadDays` is what makes the runway
  honest: sorting and colour follow the ACTIONABLE date, so a passport needing
  6-month validity goes red months before it expires.
- Billers/documents live in the existing `family_profile` JSON column;
  `billerQueryFor()` is a SEPARATE Gmail query (90d, vs the school pane's 14d)
  so the school digest never reads financial mail and vice versa.
- Owner-only, like the school digest and more so: it reports amounts and
  account tails. Accounts are masked to four digits at render (`maskAccount`)
  and never stored; amounts are kept only to compare a bill to its own past.
- **Degrades to the deterministic half.** If the model call fails, cadence and
  document runway still compute, so the pane reports those rather than going
  blank — and the AI-off banner says exactly that.
- Household is NOT rendered until its chip is selected (own Gmail query + model
  call); the school body became a `schoolBody()` branch rather than early
  returns, because those skipped the header and would strand a user with a
  failed school digest and no way to reach Household. The roster is fetched
  independently of either digest so the editor stays reachable when one fails.
- Mockup: `docs/mockups/household.html` → `docs/household.png`.

### Family/Household learning layer (six surfaces)
A survey for "what should the Family tab learn / capture" found a **serious hole
first**: `gmailQueryFor` scopes the school digest to `newer_than:14d` and
`lib/family.ts` cached its output for 15 minutes with **nothing persisted**. So a
form due in six weeks, mentioned once, showed on the board and silently vanished
about a fortnight later *while still being due* — the buried-obligation failure
this tab exists to prevent, reintroduced at the cache boundary. Everything else
here depends on that being fixed, because a deadline the app forgets cannot be
learned from. All six are PURE joins, no model call.

- **Persisted deadlines** (`lib/familyDeadlines.ts` + `family_deadlines` + PATCH
  on `/api/family`). The pane renders the STORED record, not the extraction.
  **An undated deadline can never lapse** — `familyDates` refuses to resolve
  "next Friday", so calling one overdue would invent the date it declined to
  guess. **LAPSED is derived** from `due_iso` vs today, never stored: no sweeper
  job, and no row rotting into the wrong state on a day the app wasn't opened.
  A re-extraction never resets lifecycle state and never overwrites a date with
  null (the SQL enforces both: `COALESCE(due_iso)`, and `state`/`state_at`/
  `first_seen` are absent from the UPDATE clause). **Lapsed stays visible**,
  sorted first, until cleared — deliberately uncomfortable. `deadlineKey` is
  (source message + normalised title): title alone duplicates on rewording,
  message alone merges two obligations in one newsletter.
- **Trip conflicts** (`lib/familyTripConflict.ts`): trips × dated obligations,
  two things held side by side and never compared. Only ANCHORED dates conflict
  (events with `needsConfirm` are excluded — that flag means the date is a
  guess). **The end date is the day you get back**, so it reports `returns`, not
  `away`; claiming someone can't do a thing they can is how a warning surface
  loses credibility. A malformed/inverted window matches nothing, never
  everything.
- **Account jeopardy** (`lib/accountJeopardy.ts`): declined payments, lapses,
  final notices — deterministic, BEFORE the model call, so it survives an AI
  outage. **PHRASES ONLY, never single words** (every bill says "payment"), and
  **suppressors run first and win outright** because billers advertise the thing
  they aren't doing ("avoid a late fee", "no past due balance"). One finding per
  message, the worst one. An empty block is never "all clear".
- **Bill history reads** (`lib/billHistory.ts`): `household_bills` was only ever
  asked "did it arrive?" and "is THIS one unusual?" — never read ALONG the
  series. `observedCadence` flags where reality contradicts the declared
  cadence, which is load-bearing because the declaration is what lets the
  silence watch tell "quarterly" from "stopped". `amountCreep` catches
  compounding rises no single step was big enough to flag, and requires *most
  steps to be increases* so a single jump (already reported by `amountDelta`)
  isn't double-counted. Naming a cadence needs `CADENCE_CONSISTENCY` of gaps
  inside the band, **not just the median** — a test caught that 8/12/60/140-day
  gaps have a median of 36 and were being called "monthly", which would have
  produced a confident wrong correction and broken the silence watch. Median
  everywhere, never mean.
- **Sender discovery** (`lib/senderDiscovery.ts` + POST `/api/family/discover`):
  the ONE search that looks outside the declared roster, because you cannot be
  reminded of a bill you forgot you had. **Its boundaries are the feature** —
  POST only (no page load, poll or digest; a prefetch can't trigger it);
  **headers only, enforced by `fetchMessageHeaders`'s Gmail `format:"metadata"`
  allow-list** so the API never returns a body and the pure module literally
  cannot see content; `discoveryQuery` is subject-shaped, window-clamped and
  `-from:` excludes everything declared; nothing is stored but the user's
  answer. Earned by billing/school-shaped SUBJECT phrases not volume, ≥2
  sightings, free mail hosts excluded (that's a person), word-bounded so
  `billingsgazette.com` isn't a biller.
- **Expected documents** (`lib/expectedDocs.ts` + `family_profile.expectations`):
  the silence watch generalised past billers — a W-2 or report card is expected
  ONCE by a date with no cadence. **"Missing" requires the date to have passed**
  (a W-2 absent on 3 January is January, not a problem). **A dead search must
  not accuse**: with no mail observed every row is `unknown`, never `overdue` —
  the inverse of "UNKNOWN is not clear", and it matters more here because a
  false missing sends the user chasing a document they already have. The match
  phrase is DECLARED, never inferred.
- **Boundary that holds across all six**: the roster is the query. Only sender
  discovery looks wider, once, on a button, at headers. If a signal can't be
  seen from declared senders, the answer is for the user to declare another
  sender — not for the app to read the whole mailbox.

### Sign-in works without client JavaScript
`signIn()` from `next-auth/react` is a CLIENT call — it fetches
`/api/auth/csrf`, then POSTs to `/api/auth/signin/google`. On a locked-down
machine where script execution is filtered (or that csrf fetch is blocked) the
click produces **literally nothing**, which is how it presents: "the Login with
Google button does not work" while `accounts.google.com` itself loads fine.
Reachability of Google is therefore NOT the diagnostic — if Google loads and
the button is inert, the fault is our client JS, not the network.

- `components/GoogleSignInForm.tsx` is a **Server Action inside a plain
  `<form>`** using the server `signIn` exported from `lib/auth.ts`. Next.js
  progressively enhances it: with JS it posts in the background, without JS the
  browser submits natively and the server issues the redirect. Everything after
  that is ordinary top-level navigation, which a restricted browser does not
  interfere with.
- It is passed into `LoginPanel` as `signInSlot` (children) because LoginPanel
  is `"use client"` and cannot import a Server Action module itself. The old
  client button survives only as the fallback when no slot is supplied.
- The in-app re-auth prompts (SessionExpiredBanner, NewsFeed, EmailTab,
  calendar SignInButton) are now plain `<a href="/login">` anchors. As client
  `signIn()` calls they failed the same way, but worse — the user was already
  stranded mid-session with a button that did nothing.
- A device-pairing / RFC-8628 flow was designed for the case where
  accounts.google.com is genuinely unreachable, and deliberately NOT built:
  Google turned out to be reachable. If it is ever needed, note the real cost
  is not the pairing itself but that ~60 routes gate on `session?.accessToken`
  (the Google token), so a tokenless session 401s everywhere until "needs a
  session" is split from "needs Google".

### Watchlist recommendations (the trend layer, finally consumed)
`signal_daily_counts` is written by SIX sources (OSINT feed, News, Threads
labels, conflict events, ACLED, severe weather) and `getTrendMovers()` already
classifies every term `new/rising/fading/steady` — but until now only
`/api/trends` and six lines of the brief prompt read any of it. The watchlist
recommendations close that gap with **no model call and no new fetch**: one
indexed aggregate over data the app already collects.

- `lib/watchlistSuggest.ts` (PURE, tested) takes movers + watchlist +
  dismissals → `{ add, drop }`, each row carrying its evidence string.
- **ADD**: `new`/`rising` movers of kind topic/region/aor, ≥5 mentions, term
  ≥4 chars. `label` kind is excluded on purpose — thread labels are editorial
  groupings the model coined ("IRAN WAR"), not search terms. `isCovered()`
  suppresses a candidate when the watchlist already contains it OR a substring
  of it: watching "Hormuz" catches "Strait of Hormuz", so proposing the longer
  form is noise.
- **DROP is the half nobody asks for.** A watchlist only ever grows, and every
  dead term costs attention on every screen that renders it — the same
  Christmas-tree failure the I&W board's "colour is earned" rule prevents.
  Only `watch`-kind movers qualify (those counts come from `watchTermsIn()`,
  i.e. times YOUR list actually matched), and a term with **no mover row at
  all is never proposed for removal** — absence of data is indistinguishable
  from a term added yesterday.
- Dismissals persist in `user_prefs.dismissed_watch_suggestions` (additive
  column, mirrors `dismissed_vip_suggestions`). Two namespaces in one column:
  a bare term = "never suggest adding this", `drop:term` = "stop telling me to
  remove it". Accepting a removal auto-dismisses its drop suggestion.
- `/api/osint/watchlist-suggestions` GET computes; POST takes
  `add`/`remove`/`dismiss`. POST is owner-only because `saveUserPrefs` writes
  the shared team row. UI card sits at the top of the OSINT **Sources** pane
  and renders nothing when there is nothing to say.
- Design rule for any future suggestion surface: **every row states its
  evidence, and dismissal is permanent.** A recommendation without a reason is
  a nag; one that returns after being declined teaches the user to ignore the
  panel.

### The learning layer (four surfaces that read the app's own history)
A survey for "where could the app learn from me / show me a connection I
couldn't see" found the same shape as the watchlist recommendations: data the
app already writes and nobody reads. **All four are PURE joins — no model call,
no new fetch** (the AI-spend rule: nothing pays for a derived insight).

- **Chronic vs acute** (`lib/chronicity.ts`, tested). `force_posture_daily` and
  `sitrep_status_daily` were read for a ONE-DAY delta only, so "amber twelve of
  the last fourteen days" and "amber since this morning" rendered identically.
  Returns `new|recurring|chronic|improving|quiet|unknown`; `ForceAssessment`
  carries `chronicity`. Two load-bearing rules: **ratios are against days
  OBSERVED, never calendar days** (these tables are written lazily, only on
  days the app was opened — "2 of 14" would under-report a chronic problem on
  exactly the week you were away), and "the previous day" means the previous
  OBSERVED day so a recording gap cannot read as a recovery. Below
  `MIN_OBSERVED` it returns `unknown` and says how little history it has.
  `UNKNOWN` severity is NOT elevated — a dead feed must not accumulate into a
  chronic claim. Rendered as a muted chip on Mobility Watch (CHRONIC is quieter
  than NEW on purpose) and as the full sentence in Regional.
- **Reactivation** (`lib/reactivation.ts` → `/api/osint/reactivations` →
  `ReactivationCard` on Watch). Closes the `saved_items` gap: a save is the
  strongest signal the user produces and fed NOTHING, while `article_prefs`
  (clicks) feeds news sort, the digest and trends. Joins saved items + doc
  titles/**aliases only** (a title is a statement of subject; a body mentions
  everything) against trend movers, non-calm I&W boards and disasters.
  **Dormancy IS the feature** — an interest must be 14+ days old, or the card
  is just your saved list again. Matching is word-bounded via lookarounds
  ("Hormuz" hits "Strait of Hormuz." not "Hormuzian"), ≥4 chars, terms
  regex-escaped before compiling, plus a small stoplist of vocabulary every doc
  in a mobility corpus contains. Dismissal is per **interest+term** (muting one
  term doesn't mute the item forever), stored as a third prefixed namespace in
  `dismissed_watch_suggestions` — no migration.
- **Convergence** (`lib/convergence.ts` → `/api/osint/convergence` →
  `ConvergenceCard` on Watch). The Crisis map's convergence strip sees only map
  layers and groups by AOR (a whole COCOM); this spans feeds / I&W / disasters /
  posture / base status and groups by SUBJECT. **Convergence means DISTINCT
  KINDS** — three disaster alerts in one country is one story told three times,
  the single-source trap behind "own-source-only caps at WATCH"; only the
  strongest signal per kind is kept so a chatty surface can't inflate a row.
  **Breadth beats intensity** in ranking (a loud single source is already
  visible on its own pane; weights only break ties). `canonicalSubject` joins
  the different names surfaces give one place ("Iran (Islamic Republic of)" vs
  "Iran") and **iterates to a fixed point** — a test caught stacked prefixes
  ("The Republic of Iraq") surviving a single pass. Its pattern list stays
  deliberately small: over-eager normalising merges distinct places, a worse
  failure than a missed join. No dismiss control — it is derived live from
  current conditions, not a recommendation.
- **I&W decision log** (`lib/decisionLog.ts` pure + `lib/decisionStore.ts` +
  `/api/warning/decision` + `DecisionLog.tsx` inline on each problem card, and
  the new `warning_decisions` table — SHARED per problem like `sitrep_limfacs`,
  attributed by `by_email`). `warningTaxonomy.ts` already required a
  pre-registered **falsifier** per indicator, but nothing recorded a call or
  checked one, so the falsifiers were decoration. An entry is call +
  expectation + horizon (7/14/30); at the horizon the board reopens it and asks
  you to score right/wrong/ambiguous. Disciplines: **the app never scores for
  you** — it only reopens; **scoring is ONE-WAY** (the UPDATE requires
  `outcome IS NULL`, because a re-scoreable entry is one you can quietly make
  yourself right about, and same for delete-while-open-only);
  **ambiguous is first-class but stays VISIBLE** — excluded from the hit-rate
  ratio yet reported separately, because a log that is mostly ambiguous means
  the expectations aren't sharp enough and that IS the finding; and **below
  `MIN_SCORED_FOR_RATE` decided entries there is no percentage**, only a tally
  (two-for-three is not 67% skill). `validateDraft` runs in the UI *and* at the
  route — an expectation under 8 chars is rejected because an unscoreable entry
  makes the hit rate look better-founded than it is.
- Also added: **`app:navigate`** window event in `TabShell` (validated against
  `VALID_TABS`) — the missing cross-tab primitive. Glance gets `onNavigate` as
  a prop because it is a direct child; anything nested deeper (a card inside
  OSINT → WatchPane) would need it drilled three levels for one link.
