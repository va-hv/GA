/** @type {import('next').NextConfig} */
const headers = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Only this site's own files; images may also be photos (data:) and the camera preview (blob:). Next.js needs inline
  // scripts and styles for its pages, so those stay allowed; nothing can be loaded from or sent to another site.
  { key: 'Content-Security-Policy', value: [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'", "font-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ') },
];
export default {
  output: 'standalone',
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers }]; },
};
