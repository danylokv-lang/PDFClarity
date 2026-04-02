import type { NextConfig } from "next";

if (process.env.NODE_ENV === "development") {
  const { setupDevPlatform } = require("@cloudflare/next-on-pages/next-dev");
  void setupDevPlatform();
}

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Redirect root to the static landing page so Next.js never
      // pre-renders an empty index.html that overwrites public/index.html
      { source: "/", destination: "/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
