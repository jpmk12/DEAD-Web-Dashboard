// Production start entry point. The platform runs `npm start`.
//
// Uses Next.js's own production server (`next start`) — the documented,
// supported way to run a Next.js app on this platform — instead of a custom
// server, which can mis-route App Router pages/API routes.
//
// - Resolves Next's CLI directly (no dependency on PATH/node_modules/.bin).
// - Forces a standard NODE_ENV: the platform injects a non-standard value,
//   which otherwise makes Next/React use development runtimes.
// - Binds 0.0.0.0 on the platform-provided PORT so the proxy can reach it.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Startup diagnostic: log which required env vars are present (names only,
// never values). A missing one is the usual cause of Auth.js's
// "There is a problem with the server configuration" error at sign-in.
const checks = {
  "AUTH_SECRET / NEXTAUTH_SECRET": process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  "AUTH_URL / NEXTAUTH_URL": process.env.AUTH_URL || process.env.NEXTAUTH_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  OWNER_EMAIL: process.env.OWNER_EMAIL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
};
console.log("[startup] required env var presence:");
for (const [name, val] of Object.entries(checks)) {
  console.log(`  ${val ? "[ OK ]   " : "[MISSING]"} ${name}`);
}

const port = String(process.env.PORT || 3000);
const nextBin = require.resolve("next/dist/bin/next");

// Self-heal a missing production build. If the platform's build step didn't run
// or failed, `.next/prerender-manifest.json` is absent and `next start` crashes
// with "ENOENT .next/prerender-manifest.json". Build once, synchronously, before
// starting. When the build ran normally this is a cheap existence check and a
// no-op.
const prerenderManifest = path.join(__dirname, ".next", "prerender-manifest.json");
if (!fs.existsSync(prerenderManifest)) {
  console.log("[startup] no production build found (.next/prerender-manifest.json missing) — running 'next build'");
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (build.status !== 0) {
    console.error("[startup] 'next build' failed; cannot start without a production build");
    process.exit(build.status ?? 1);
  }
}

// The platform's proxy hands the app an internal host (e.g. 0.0.0.0:PORT).
// Auth.js builds OAuth redirect URLs from AUTH_URL/NEXTAUTH_URL when set, and
// only falls back to that broken host when neither is set. Default them to the
// public domain so sign-in always uses the right origin. Override by setting
// NEXTAUTH_URL in the platform env if the domain changes.
const siteUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "https://justinpoole.com";

const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", NEXTAUTH_URL: siteUrl, AUTH_URL: siteUrl },
});

child.on("exit", (code) => process.exit(code ?? 0));
