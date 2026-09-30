import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const isDev = process.env.NODE_ENV !== 'production';

// Next.js needs inline scripts; tighten with nonces later. No third-party origins are allowed.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The shared-document viewer shows the PDF (an object URL made by the page itself) in a frame. No plugins, no other frames.
  "frame-src blob:",
  "object-src 'none'",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Same-origin API: the browser only talks to this app, which forwards /api to NestJS. No CORS needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Reset and invitation links carry tokens in the URL: never leak them through Referer.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      {
        // Token pages must never be cached or indexed.
        source: '/:page(checkin|s|reset-password|accept-invitation)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
