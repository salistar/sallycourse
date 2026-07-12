import {
  connectDb,
  Course,
  Section,
  Lesson,
  Quiz,
  CourseMarketplaceListing,
  CourseMarketplacePurchase,
  type ICourse,
} from '@sallycourse/db';
import { computeRevenueShare } from '@sallycourse/shared';

/**
 * Achat marketplace (Prompt 147) : à la conclusion du paiement (réutilise le
 * pipeline CMI/Paddle existant P54), duplique le Course vendu pour l'acheteur
 * SANS aucun rappel LLM — réutilise la logique de dérivation de P64 (clone
 * direct) mais sans traduction/changement de niveau : simple copie
 * indépendante (Course + Section + Lesson + Quiz). Vit côté web (pas dans le
 * worker) car ce sont de pures opérations Mongoose, appelées synchrone au
 * checkout — pas de job de génération à enfiler.
 */

export interface DuplicatePurchaseResult {
  ok: boolean;
  reason?: 'listing_not_found' | 'listing_inactive' | 'course_missing';
  deliveredCourseId?: string;
  purchaseId?: string;
}

/**
 * Duplique le cours source d'un listing 'course-copy' pour l'acheteur : copie
 * l'outline + toutes les sections/leçons/quiz en préservant l'ordre. Le cours
 * dupliqué démarre au statut 'ready' (contenu déjà généré) et appartient
 * exclusivement à l'acheteur — aucune référence croisée vers le vendeur.
 */
async function duplicateCourseForBuyer(sourceCourseId: string, buyerId: string): Promise<string> {
  const source = await Course.findById(sourceCourseId).lean<ICourse & { _id: unknown }>();
  if (!source) throw new Error('course_missing');

  const duplicated = await Course.create({
    userId: buyerId,
    title: source.title,
    difficulty: source.difficulty,
    locale: source.locale,
    outline: source.outline ?? null,
    targetPlatforms: [],
    ttsVoice: source.ttsVoice,
    watermark: source.watermark,
    status: 'ready',
  });

  const sections = await Section.find({ courseId: sourceCourseId }).sort({ order: 1 }).lean();
  for (const section of sections) {
    const newSection = await Section.create({
      courseId: duplicated._id,
      order: section.order,
      title: section.title,
    });

    const lessons = await Lesson.find({ sectionId: section._id }).sort({ order: 1 }).lean();
    for (const lesson of lessons) {
      const newLesson = await Lesson.create({
        sectionId: newSection._id,
        courseId: duplicated._id,
        order: lesson.order,
        title: lesson.title,
        type: lesson.type,
        status: lesson.status,
        durationMin: lesson.durationMin,
        summary: lesson.summary,
        generatedSummary: lesson.generatedSummary,
        script: lesson.script ?? null,
        assets: lesson.assets ?? {},
        contentHash: lesson.contentHash,
      });

      if (lesson.type === 'quiz') {
        const quiz = await Quiz.findOne({ lessonId: lesson._id }).lean();
        if (quiz) {
          await Quiz.create({
            lessonId: newLesson._id,
            sectionId: newSection._id,
            courseId: duplicated._id,
            questions: quiz.questions ?? [],
          });
        }
      }
    }
  }

  return duplicated._id.toString();
}

/**
 * Traite un achat marketplace confirmé. Idempotent via `providerRef` (index
 * unique CourseMarketplacePurchase.providerRef) : rejouer le même providerRef
 * renvoie le purchase existant sans dupliquer une deuxième fois le cours.
 */
export async function processMarketplacePurchase(params: {
  listingId: string;
  buyerId: string;
  provider: 'cmi' | 'paddle' | 'mock' | 'free';
  providerRef: string;
}): Promise<DuplicatePurchaseResult> {
  await connectDb();

  const listing = await CourseMarketplaceListing.findById(params.listingId).lean();
  if (!listing) return { ok: false, reason: 'listing_not_found' };
  if (listing.status !== 'active') return { ok: false, reason: 'listing_inactive' };

  const existing = await CourseMarketplacePurchase.findOne({ providerRef: params.providerRef }).lean();
  if (existing) {
    return {
      ok: true,
      deliveredCourseId: existing.deliveredCourseId ? String(existing.deliveredCourseId) : undefined,
      purchaseId: String(existing._id),
    };
  }

  const share = computeRevenueShare(listing.priceCents, listing.platformFeeRate);

  let deliveredCourseId: string | undefined;
  if (listing.licenseType === 'course-copy') {
    try {
      deliveredCourseId = await duplicateCourseForBuyer(String(listing.courseId), params.buyerId);
    } catch {
      return { ok: false, reason: 'course_missing' };
    }
  }

  let purchase;
  try {
    purchase = await CourseMarketplacePurchase.create({
      listingId: listing._id,
      sourceCourseId: listing.courseId,
      sellerId: listing.sellerId,
      buyerId: params.buyerId,
      deliveredCourseId: deliveredCourseId ?? null,
      priceCents: share.priceCents,
      currency: listing.currency,
      platformFeeCents: share.platformFeeCents,
      sellerNetCents: share.sellerNetCents,
      provider: params.provider,
      providerRef: params.providerRef,
    });
  } catch {
    const raced = await CourseMarketplacePurchase.findOne({ providerRef: params.providerRef }).lean();
    if (raced) {
      return {
        ok: true,
        deliveredCourseId: raced.deliveredCourseId ? String(raced.deliveredCourseId) : undefined,
        purchaseId: String(raced._id),
      };
    }
    throw new Error('Achat marketplace : conflit non résolu.');
  }

  await CourseMarketplaceListing.updateOne(
    { _id: listing._id },
    { $inc: { salesCount: 1, netRevenueCents: share.sellerNetCents } },
  );

  return { ok: true, deliveredCourseId, purchaseId: purchase._id.toString() };
}

/** STUB paiement marketplace : gratuit ou mode mock → accès accordé immédiatement (même pattern que cmiCheckoutStub P43). */
export function marketplaceCheckoutStub(priceCents: number, mock: boolean): { granted: boolean; reason: string } {
  if (priceCents <= 0) return { granted: true, reason: 'Listing gratuit — copie immédiate.' };
  if (mock) return { granted: true, reason: '[mock] Paiement marketplace simulé — copie accordée.' };
  return { granted: false, reason: 'Paiement requis (CMI/Paddle) avant duplication du cours.' };
}
