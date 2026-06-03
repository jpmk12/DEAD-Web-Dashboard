// Build entry point that guarantees a production build regardless of the
// hosting platform's NODE_ENV.
//
// The platform injects a non-standard NODE_ENV. When NODE_ENV is not exactly
// "production", Next.js and React use their *development* runtimes during the
// build, and the dev error-page path imports <Html>, crashing the prerender of
// /404 and /500 with "<Html> should not be imported outside of pages/_document".
// Forcing NODE_ENV=production for the build child avoids that entirely.
//
// It also wipes .next first so a stale/partial build dir can't corrupt the build.
const { rmSync } = require("fs");
const { spawnSync } = require("child_process");

rmSync(".next", { recursive: true, force: true });

// Resolve Next's CLI directly instead of relying on `next` being on PATH or in
// node_modules/.bin — neither is reliable on this platform (same reason start.js
// resolves it this way). A shelled-out `next build` here failed silently, which
// left no production build and made `next start` crash with
// "ENOENT .next/prerender-manifest.json".
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

process.exit(result.status ?? 1);
