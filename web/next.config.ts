import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.TELEOP_DEMO_DIST_DIR ?? ".next",
  /* config options here */
};

export default nextConfig;
