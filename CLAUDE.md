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

### Database
- Uses the managed MySQL via `mysql2` (`lib/db.ts`), reading
  `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` from `process.env`.
- All 7 tables are created automatically on first connection
  (`CREATE TABLE IF NOT EXISTS`), so no manual schema import is needed.
- All queries are parameterized (`?` placeholders) — never interpolate input.

### Other env vars (set via the Node.js Hosting UI — see `.env.example`)
`NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ANTHROPIC_API_KEY`, `GMAIL_SECONDARY_REDIRECT_URI`, `OWNER_EMAIL`.

### Network
All outbound calls are HTTPS (443): Anthropic, Google APIs, RSS feeds, Twitter/X
embeds. The only non-HTTP connection is to the platform's managed MySQL, which is
explicitly allowed.
