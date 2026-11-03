/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'https://qamqor-api.onrender.com/api/v1/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
