/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
        config.externals.push('pino-pretty', 'lokijs', 'encoding') // list modules in error messages
        return config
    },
    experimental: {
        serverActions: true,
    },
}

module.exports = nextConfig
