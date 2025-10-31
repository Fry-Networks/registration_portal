/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['avatars.githubusercontent.com', 'avatar.vercel.sh', 'static.wixstatic.com']
  },
  experimental: {
    // Server actions are stable in Next 13.4+, no longer experimental
    // Only keep serverComponentsExternalPackages for specific packages
    serverComponentsExternalPackages: ['@tremor/react']
  }
};

module.exports = nextConfig;
