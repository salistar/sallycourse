import type { MetadataRoute } from 'next';

// Sitemap statique des pages publiques (P95). Lecture directe de process.env
// (et non getConfig()) : cette route est évaluée par Next au build sans que
// l'environnement complet (Mongo/S3/Auth) soit forcément disponible.
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const PUBLIC_ROUTES = [
  { path: '/', priority: 1, changeFrequency: 'weekly' as const },
  { path: '/pricing', priority: 0.8, changeFrequency: 'weekly' as const },
  { path: '/showcase', priority: 0.7, changeFrequency: 'daily' as const },
  { path: '/legal/cgu', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/cgv', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/confidentialite', priority: 0.3, changeFrequency: 'yearly' as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${APP_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
