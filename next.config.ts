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
              // TradingView widget loader scripts + Twitter embeds
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://platform.twitter.com https://abs.twimg.com https://x.com https://s3.tradingview.com https://*.tradingview.com https://*.tradingview-widget.com",
              // Windy map embed + TradingView widget iframes + Twitter +
              // OSINT aircraft/maritime iframe providers (the page blocks any
              // frame whose origin isn't listed here — without these the
              // maritime/aircraft "Iframe provider" panes render blank even
              // though the providers allow embedding).
              // NOTE: TradingView widgets iframe from tradingview-widget.com,
              // a different registrable domain that *.tradingview.com does NOT
              // match — it must be listed explicitly or the widgets are blocked.
              "frame-src https://platform.twitter.com https://syndication.twitter.com https://twitter.com https://x.com https://embed.windy.com https://*.tradingview.com https://www.tradingview.com https://*.tradingview-widget.com https://globe.adsb.fi https://globe.airplanes.live https://globe.adsb.lol https://globe.adsbexchange.com https://www.vesselfinder.com https://www.marinetraffic.com https://map.openseamap.org",
              // TradingView injects styles + Twitter
              "style-src 'self' 'unsafe-inline' https://platform.twitter.com https://abs.twimg.com https://x.com https://*.tradingview.com",
              "img-src 'self' data: https:",
              // TradingView market data feed + zipcode lookup + existing sources
              "connect-src 'self' https://api.anthropic.com https://www.googleapis.com https://accounts.google.com https://syndication.twitter.com https://cdn.syndication.twimg.com https://twitter.com https://x.com https://api.x.com https://t.co https://*.tradingview.com https://*.tradingview-widget.com https://api.zippopotam.us",
              "font-src 'self' https://fonts.gstatic.com https://*.tradingview.com",
              // TradingView uses blob: web workers internally
              "worker-src 'self' blob:",
              "child-src blob: https://*.tradingview.com https://*.tradingview-widget.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security",  value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
