import type { NextConfig } from "next";

// Deployed as a Node.js app on GoDaddy Node.js Hosting:
// the platform runs `npm install && npm start` (which calls `next start`)
// and injects PORT, which `next start` honors automatically.
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
