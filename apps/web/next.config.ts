import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Both workspace packages ship raw TypeScript sources.
  transpilePackages: ['@lazy-sunday/engine', '@lazy-sunday/server'],
};

export default nextConfig;
