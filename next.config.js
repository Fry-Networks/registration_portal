/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatar.vercel.sh',
      },
      {
        protocol: 'https',
        hostname: 'static.wixstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.perawallet.app',
      },
      {
        protocol: 'https',
        hostname: 'defly.app',
      }
    ]
  },
  // Next.js 15 configurations
  transpilePackages: ['@tremor/react'],
  turbopack: {}
};

module.exports = nextConfig;
