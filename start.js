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
const { spawn } = require("child_process");

const port = String(process.env.PORT || 3000);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

child.on("exit", (code) => process.exit(code ?? 0));
