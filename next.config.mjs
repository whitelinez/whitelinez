/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security",  value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Cache-Control",              value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "connect-src 'self' https://*.supabase.co wss: https://*.railway.app https://backend.aitrafficja.com https://cdn.jsdelivr.net https://*.ipcamlive.com https://*.vercel-analytics.com https://vitals.vercel-insights.com https://cloudflareinsights.com",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob: https://*.vercel-analytics.com https://static.cloudflareinsights.com",
              "worker-src blob:",
              "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: https://*.supabase.co https://*.ipcamlive.com https://img.youtube.com",
              "media-src 'self' blob: https://*.ipcamlive.com https://*.supabase.co",
              "frame-src https://*.ipcamlive.com https://www.youtube.com https://www.youtube-nocookie.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/img/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/(favicon.svg|robots.txt|sitemap.xml)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.ipcamlive.com" },
    ],
  },
};

export default nextConfig;
