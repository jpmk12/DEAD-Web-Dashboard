import type { NextConfig } from "next";

// Deployed as a Node.js app on GoDaddy Node.js Hosting:
// the platform runs `npm install && npm start` (which calls `next start`)
// and injects PORT, which `next start` honors automatically.
const nextConfig: NextConfig = {
  // `ws` (the AISStream client) must be required at runtime, not webpack-bundled
  // into the server output — bundling breaks its frame-masking module and throws
  // "TypeError: t.mask is not a function" as an uncaughtException that crashes
  // the Node process.
  serverExternalPackages: ["ws"],
  // ESLint is a dev-only dependency; the platform installs with
  // `npm install --production`, so eslint isn't present at build time.
  // Skip lint during build (run `npm run lint` locally instead).
  eslint: { ignoreDuringBuilds: true },
  // Type-checking spawns a memory-heavy worker that can OOM the platform's
  // build container. Types are verified locally; skip the in-build check.
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // No third-party scripts: the TradingView widgets, the Twitter
              // embeds and the aircraft/maritime iframe panes were all retired
              // (code review 2026-10-28 narrowed every directive to what the
              // app still loads).
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
              // 'self' first: the Docs tab frames /api/files/:id/inline for the
              // PDF preview — without it (and with frame-ancestors 'none' on
              // the file response itself) our own CSP refused our own PDFs
              // (REVIEW-2026-10 D1). Windy is the Weather tab's radar map.
              "frame-src 'self' https://embed.windy.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              // The browser talks only to our own routes; every external feed
              // is fetched server-side. Google stays for the OAuth hops.
              "connect-src 'self' https://www.googleapis.com https://accounts.google.com",
              "font-src 'self' https://fonts.gstatic.com",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              // 'self', not 'none': the inline file route is framed by the Docs
              // tab; no other origin may frame the app.
              "frame-ancestors 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          // geolocation is delegated ONLY to the Windy radar iframe (which
          // carries allow="geolocation" for its "locate me" control). Our own
          // top document is NOT in the allowlist, so first-party code still
          // can't read location; camera/mic/payment stay fully blocked. Without
          // this the iframe's allow attr is a no-op and Windy trips a
          // "Permissions policy violation: Geolocation" console error on load.
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=(\"https://embed.windy.com\"), payment=()" },
          { key: "Strict-Transport-Security",  value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
