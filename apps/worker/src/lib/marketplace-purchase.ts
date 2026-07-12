// Achat marketplace (Prompt 147) : à la conclusion du paiement, duplique le
// Course vendu pour l'acheteur SANS aucun rappel LLM — réutilise la logique de
// dérivation de P64 (clone direct) mais sans traduction/changement de niveau :
// simple copie indépendante (Course + Section + Lesson + Quiz). L'acheteur
// obtient un cours à lui, détaché du vendeur (aucune référence croisée hormis
// CourseMarketplacePurchase.sourceCourseId à titre d'historique).
import {
  Course,
  Section,
  Lesson,
  Quiz,
  CourseMarketplaceListing,
  CourseMarketplacePurchase,
  computeRevenueShare,
  type ICourse,
} from '../shared.js';

export interface DuplicatePurchaseResult {
  ok: boolean;
  /** Motif d'échec si ok=false. */
  reason?: 'listing_not_found' | 'listing_inactive' | 'already_purchased' | 'course_missing';
  deliveredCourseId?: string;
  purchaseId?: string;
}

/**
 * Duplique le cours source d'un listing 'course-copy' pour l'acheteur : copie
 * l'outline + toutes les sections/leçons/quiz en préservant l'ordre, sans
 * jamais réutiliser l'ObjectId source (nouveaux documents indépendants). Le
 * cours dupliqué démarre au statut 'ready' (contenu déjà généré, pas de
 * re-génération) et appartient exclusivement à l'acheteur.
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
    // Champs marketing/qualité/avatar/etc. volontairement NON copiés : l'acheteur
    // reprend le contenu pédagogique, pas l'historique de publication du vendeur.
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
        // versions/similarityWarning/originalityScore : historique propre au
        // vendeur, non pertinent pour la copie de l'acheteur.
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
 * Traite un achat marketplace confirmé (paiement capturé côté route CMI/Paddle) :
 * idempotent via `providerRef` (index unique CourseMarketplacePurchase.providerRef) —
 * si l'insertion échoue pour cause de doublon, on renvoie le purchase existant
 * sans dupliquer une deuxième fois le cours.
 */
export async function processMarketplacePurchase(params: {
  listingId: string;
  buyerId: string;
  provider: 'cmi' | 'paddle' | 'mock' | 'free';
  providerRef: string;
}): Promise<DuplicatePurchaseResult> {
  const listing = await CourseMarketplaceListing.findById(params.listingId).lean();
  if (!listing) return { ok: false, reason: 'listing_not_found' };
  if (listing.status !== 'active') return { ok: false, reason: 'listing_inactive' };

  // Idempotence : rejouer le même providerRef ne duplique jamais deux fois.
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
  // 'template-only' : rien à dupliquer ici — l'acheteur récupère l'outline via
  // l'API (lecture du listing), sans nouveau Course créé automatiquement.

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
    // Doublon concurrent sur providerRef (course race) : renvoie l'existant.
    const raced = await CourseMarketplacePurchase.findOne({ providerRef: params.providerRef }).lean();
    if (raced) {
      return {
        ok: true,
        deliveredCourseId: raced.deliveredCourseId ? String(raced.deliveredCourseId) : undefined,
        purchaseId: String(raced._id),
      };
    }
    return { ok: false, reason: 'already_purchased' };
  }

  await CourseMarketplaceListing.updateOne(
    { _id: listing._id },
    { $inc: { salesCount: 1, netRevenueCents: share.sellerNetCents } },
  );

  return { ok: true, deliveredCourseId, purchaseId: purchase._id.toString() };
}
