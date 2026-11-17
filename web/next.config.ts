import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.TELEOP_DEMO_DIST_DIR ?? ".next",
  // Inlined into client code.
  env: { PROVIDE_CONTROL_QUEUE: process.env.PROVIDE_CONTROL_QUEUE === '1' ? '1' : '0' },
};

export default nextConfig;
