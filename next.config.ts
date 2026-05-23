import type { NextConfig } from "next";

// Static export so the built `out/` directory is plain HTML/CSS/JS
// and can be uploaded to GoDaddy cPanel (no Node runtime required).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
