// Build-time guard (2026-08-06). A NEXT_PUBLIC_* variable is inlined into the client bundle
// and would be readable by every visitor (production source maps are disabled below, but an
// inlined value ships in the bundle regardless). A mnemonic must never travel that path, so
// fail the build rather than ship one.
// The server-only equivalent is ALGORAND_DEV_MNEMONIC.
if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC) {
  throw new Error(
    'A NEXT_PUBLIC_ Algorand mnemonic variable is set. NEXT_PUBLIC_ values are inlined into ' +
    'the client bundle and served to every visitor. Use server-only ALGORAND_DEV_MNEMONIC.'
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
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
  turbopack: {},
  // /rewards-claim drove an on-chain pool-contract call; rewards are paid from the hot
  // wallet on manual claim, so the page could only ever fail. Retired to /history.
  async redirects() {
    return [
      { source: '/rewards-claim', destination: '/history', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
