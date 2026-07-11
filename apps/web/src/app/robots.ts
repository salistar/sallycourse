import type { MetadataRoute } from 'next';

// robots.txt (P95) — le dashboard/admin et les API restent privés côté crawl.
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/api', '/learn'],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
