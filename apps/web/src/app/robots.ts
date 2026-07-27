import type { MetadataRoute } from 'next';

// robots.txt (P95) — le dashboard/admin et les API restent privés côté crawl.
// Le blog SEO (P204) est explicitement AUTORISÉ : c'est le canal d'acquisition
// organique des cours. Les pages de cours publiées /learn/[courseId] sont la
// CIBLE de ce tunnel (CTA + JSON-LD Course) : elles doivent être crawlables,
// sinon le JSON-LD et les liens du blog pointent vers une URL non indexable.
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/blog', '/learn'],
      disallow: ['/dashboard', '/admin', '/api'],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
