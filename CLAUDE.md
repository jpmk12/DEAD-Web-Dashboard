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
curated. Collapsed by default (`showAllDisasters`).

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
the OSINT feed-pane "AOR contacts" strip. OSINT panes are now: **All / Social /
Telegram / News / Crisis / Ground**.

### Ground Truth (OSINT "Ground" sub-pane — per-country situation room)
A **sub-pane of OSINT** (not a top-level tab), rendered when the OSINT pane is
`"ground"` (`components/ground/GroundTruthTab.tsx`). A country rail + detail panel
("situation room") for the locations in the **Force Protection watch**.

- **Rail** is built from the *whole* watch list: watched **countries** AND the
  **countries of watched airports/bases** (grouped by country; 🛡 marks a country
  with a pinned airfield). A country watch is the primary posture; otherwise the
  worst base in that country stands in. Source is the shared `/api/force-protection`
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
- No new npm dep (existing react-leaflet + server-side rss-parser + pure fetch),
  so `grep -c esbuild package-lock.json` stays `0`.

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

### Network
All outbound calls are HTTPS (443): Anthropic, Google APIs, RSS feeds, Twitter/X
embeds, GDELT (DOC, local news), U.S. State Dept (`travel.state.gov` — the
`TAsTWs.xml` advisory RSS + the per-country `destination/{slug}.html` pages),
UCDP (`ucdpapi.pcr.uu.se`), ACLED
(`acleddata.com`), OurAirports (`davidmegginson.github.io`, airports + runways),
INFORM Risk (`data360api.worldbank.org`), RainViewer (`api.rainviewer.com` index +
`tilecache.rainviewer.com` tiles), military ADS-B (airplanes.live / adsb.lol),
OpenSky (`opensky-network.org`), NWS Aviation Weather (`aviationweather.gov`,
METAR + TAF; also the node flight-category rings via `/api/airfield-weather`),
Yahoo Finance (`query1.finance.yahoo.com`, energy/commodity quotes; Stooq
`stooq.com` is a best-effort fallback only), Nager.Date
(`date.nager.at`, public holidays), and DoD DAIP (`www.daip.jcs.mil`, NOTAMs —
needs the bundled DoD CA). The one
**WebSocket** is the AISStream vessel bridge (`wss://stream.aisstream.io`, over
443). The only non-HTTP connection is to the platform's managed MySQL, which is
explicitly allowed.
