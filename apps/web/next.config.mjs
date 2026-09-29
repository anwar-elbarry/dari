/** @type {import('next').NextConfig} */
const nextConfig = {
  // Public token pages (check-in, share viewer) must never be cached or indexed.
  async headers() {
    return [
      {
        source: '/(checkin|s)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};
export default nextConfig;
