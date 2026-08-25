import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is what puts the render on the prerender/abort path that
  // creates the errors this reproduction is about.
  cacheComponents: true,
};

export default nextConfig;
