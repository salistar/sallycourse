import type { MetadataRoute } from 'next';
import {
  connectDb,
  BlogPost as BlogPostModel,
  LmsListing as LmsListingModel,
  User as UserModel,
} from '@sallycourse/db';
import { instructorPath } from '@sallycourse/shared/instructor';

// Sitemap des pages publiques (P95) + articles de blog publiés (P204) + pages
// instructeur publiques (P205). Lecture
// directe de process.env (et non getConfig()) : cette route est évaluée par Next
// au build sans que l'environnement complet (Mongo/S3/Auth) soit forcément
// disponible — la partie blog est donc BEST-EFFORT (Mongo injoignable → sitemap
// statique seul, jamais d'échec de build).
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const PUBLIC_ROUTES = [
  { path: '/', priority: 1, changeFrequency: 'weekly' as const },
  { path: '/pricing', priority: 0.8, changeFrequency: 'weekly' as const },
  { path: '/showcase', priority: 0.7, changeFrequency: 'daily' as const },
  { path: '/blog', priority: 0.8, changeFrequency: 'daily' as const },
  { path: '/legal/cgu', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/cgv', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/confidentialite', priority: 0.3, changeFrequency: 'yearly' as const },
];

/** Articles de blog PUBLIÉS (les articles programmés restent hors sitemap). */
async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    await connectDb();
    const posts = await BlogPostModel.find({ status: 'published' })
      .select('slug updatedAt publishedAt')
      .sort({ publishedAt: -1 })
      .limit(5000)
      .lean();
    return posts.map((post) => ({
      url: `${APP_URL}/blog/${post.slug}`,
      lastModified: post.updatedAt ?? post.publishedAt ?? new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}

/**
 * Pages instructeur (/@handle) — UNIQUEMENT celles qui ont du contenu public :
 * un handle réservé, un compte non banni ET au moins un cours publié sur le
 * LMS. Un profil vide n'entre pas dans le sitemap. BEST-EFFORT comme le blog.
 */
async function instructorEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    await connectDb();
    const publishers = await LmsListingModel.distinct('userId', { published: true });
    if (publishers.length === 0) return [];

    const instructors = await UserModel.find({
      _id: { $in: publishers },
      handle: { $exists: true, $ne: null },
      banned: { $ne: true },
    })
      .select('handle updatedAt')
      .limit(5000)
      .lean();

    return instructors
      .filter((instructor) => Boolean(instructor.handle))
      .map((instructor) => ({
        url: `${APP_URL}${instructorPath(instructor.handle!)}`,
        lastModified: instructor.updatedAt ?? new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((route) => ({
    url: `${APP_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  const [blog, instructors] = await Promise.all([blogEntries(), instructorEntries()]);
  return [...staticEntries, ...blog, ...instructors];
}
