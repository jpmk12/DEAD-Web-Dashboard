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

const result = spawnSync("next build", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "production" },
});

process.exit(result.status ?? 1);
