import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  connectDb,
  Course as CourseModel,
  CourseMarketplaceListing,
  MARKETPLACE_LICENSE_TYPES,
} from '@sallycourse/db';
import { DEFAULT_MARKETPLACE_FEE_RATE, isValidListingShape } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

/**
 * /api/marketplace — marketplace de cours entre utilisateurs (Prompt 147).
 * GET  : catalogue public des listings actifs, filtrable par catégorie
 *        (?category=). Aucune authentification requise (lecture publique).
 * POST : crée un listing pour un cours possédé par l'utilisateur connecté —
 *        { courseId, priceCents, licenseType, description, category?, currency? }.
 *        'course-copy' exige un cours au statut 'ready'/'published' (contenu
 *        généré à dupliquer) ; 'template-only' exige seulement un outline validé.
 */

export const dynamic = 'force-dynamic';

const createListingSchema = z.object({
  courseId: z.string().min(1),
  priceCents: z.number().int().min(0).max(10_000_000),
  licenseType: z.enum(MARKETPLACE_LICENSE_TYPES),
  description: z.string().trim().max(2000).default(''),
  category: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).optional(),
});

/** Forme exposée publiquement (jamais l'ownership interne au-delà de sellerId). */
function toPublicListing(doc: {
  _id: unknown;
  courseId: unknown;
  sellerId: unknown;
  priceCents: number;
  currency: string;
  licenseType: string;
  description: string;
  category?: string;
  platformFeeRate: number;
  status: string;
  salesCount: number;
  publishedAt?: Date;
  createdAt: Date;
}) {
  return {
    id: String(doc._id),
    courseId: String(doc.courseId),
    sellerId: String(doc.sellerId),
    priceCents: doc.priceCents,
    currency: doc.currency,
    licenseType: doc.licenseType,
    description: doc.description,
    category: doc.category ?? null,
    platformFeeRate: doc.platformFeeRate,
    status: doc.status,
    salesCount: doc.salesCount,
    publishedAt: doc.publishedAt ?? null,
    createdAt: doc.createdAt,
  };
}

/** GET — catalogue des listings actifs, filtrable par catégorie. */
export async function GET(request: Request) {
  await connectDb();

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim();

  const filter: Record<string, unknown> = { status: 'active' };
  if (category) filter.category = category;

  const listings = await CourseMarketplaceListing.find(filter)
    .sort({ publishedAt: -1 })
    .limit(60)
    .lean();

  // Titre du cours joint pour l'affichage catalogue (dénormalisation légère, une requête groupée).
  const courseIds = listings.map((l) => l.courseId);
  const courses = await CourseModel.find({ _id: { $in: courseIds } })
    .select('title difficulty locale')
    .lean();
  const courseById = new Map(courses.map((c) => [String(c._id), c]));

  return NextResponse.json({
    listings: listings.map((l) => ({
      ...toPublicListing(l),
      courseTitle: courseById.get(String(l.courseId))?.title ?? '',
      difficulty: courseById.get(String(l.courseId))?.difficulty ?? null,
      locale: courseById.get(String(l.courseId))?.locale ?? null,
    })),
  });
}

/** POST — crée un listing marketplace pour un cours possédé par l'utilisateur. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { courseId, priceCents, licenseType, description, category, currency } = parsed.data;
  if (!isValidObjectId(courseId)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  // Ownership : 404 (pas 403) pour ne pas révéler les cours des autres.
  const course = await CourseModel.findOne({ _id: courseId, userId: user.id })
    .select('status outline')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  if (licenseType === 'course-copy' && course.status !== 'ready' && course.status !== 'published') {
    return NextResponse.json(
      { error: 'Seul un cours entièrement généré (prêt ou publié) peut être vendu en copie intégrale.' },
      { status: 409 },
    );
  }
  if (licenseType === 'template-only' && !course.outline) {
    return NextResponse.json(
      { error: 'Ce cours n’a pas encore de plan validé à vendre en tant que template.' },
      { status: 409 },
    );
  }

  const platformFeeRate = DEFAULT_MARKETPLACE_FEE_RATE;
  if (!isValidListingShape({ priceCents, platformFeeRate, licenseType })) {
    return NextResponse.json({ error: 'Paramètres de listing invalides.' }, { status: 400 });
  }

  // Un seul listing actif par (cours, licenceType) — évite les doublons de catalogue.
  const already = await CourseMarketplaceListing.findOne({
    courseId,
    licenseType,
    status: 'active',
  }).lean();
  if (already) {
    return NextResponse.json(
      { error: 'Ce cours est déjà listé sur le marketplace avec cette licence.' },
      { status: 409 },
    );
  }

  const listing = await CourseMarketplaceListing.create({
    courseId,
    sellerId: user.id,
    priceCents,
    currency: currency ?? 'MAD',
    licenseType,
    description,
    category,
    platformFeeRate,
    status: 'active',
  });

  return NextResponse.json({ listing: toPublicListing(listing) }, { status: 201 });
}
