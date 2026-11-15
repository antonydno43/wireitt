import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel-native build. For self-hosting with a standalone server, add:
     output: "standalone"  */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
