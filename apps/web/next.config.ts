import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Both workspace packages ship raw TypeScript sources.
  transpilePackages: ['@lazy-sunday/engine', '@lazy-sunday/server'],
  // The engine uses ESM-style `./x.js` specifiers that resolve to `.ts` sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
  },
};

export default nextConfig;
