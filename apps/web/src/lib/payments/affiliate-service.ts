import { connectDb, AffiliateLink as AffiliateLinkModel } from '@sallycourse/db';
import { generateUniqueAffiliateCode, computeCommissionUsd, DEFAULT_COMMISSION_RATE } from '@/lib/affiliate';

/**
 * Accès DB pour l'affiliation (Prompt 89). Sépare la logique pure (lib/affiliate.ts,
 * testée en isolation) des opérations I/O (Mongo) — appelées depuis la route de
 * redirection /r/[code], le dashboard et le hook de crédit de commission branché
 * sur activatePlan (voir lib/payments/plans.ts).
 */

/** Récupère (ou crée) le lien d'affiliation de l'utilisateur. Idempotent. */
export async function getOrCreateAffiliateLink(userId: string) {
  await connectDb();
  const existing = await AffiliateLinkModel.findOne({ userId }).sort({ createdAt: -1 }).lean();
  if (existing) return existing;

  const code = await generateUniqueAffiliateCode(async (c) => {
    const hit = await AffiliateLinkModel.exists({ code: c });
    return hit != null;
  });

  const created = await AffiliateLinkModel.create({
    userId,
    code,
    commissionRate: DEFAULT_COMMISSION_RATE,
  });
  return created.toObject();
}

/** Incrémente le compteur de clics d'un code (best-effort — n'échoue jamais l'appelant). */
export async function recordAffiliateClick(code: string): Promise<boolean> {
  await connectDb();
  const res = await AffiliateLinkModel.updateOne({ code }, { $inc: { clicks: 1 } });
  return res.matchedCount > 0;
}

/**
 * Crédite une commission en attente sur le lien référent, à l'activation d'un
 * abonnement payant. Best-effort : les erreurs sont avalées par l'appelant
 * (ne doit jamais faire échouer l'activation du plan elle-même). `amountUsd`
 * est le montant du paiement à l'origine de la conversion (déjà en USD approx).
 */
export async function creditAffiliateConversion(code: string, amountUsd: number): Promise<void> {
  await connectDb();
  const link = await AffiliateLinkModel.findOne({ code }).lean();
  if (!link) return;

  const commission = computeCommissionUsd(amountUsd, link.commissionRate);
  await AffiliateLinkModel.updateOne(
    { code },
    { $inc: { conversions: 1, pendingCommissionsUsd: commission } },
  );
}

/** Statistiques exposées au dashboard affilié de l'utilisateur. */
export interface AffiliateStats {
  code: string;
  clicks: number;
  conversions: number;
  commissionRate: number;
  pendingCommissionsUsd: number;
  paidCommissionsUsd: number;
}

export async function getAffiliateStats(userId: string): Promise<AffiliateStats> {
  const link = await getOrCreateAffiliateLink(userId);
  return {
    code: link.code,
    clicks: link.clicks,
    conversions: link.conversions,
    commissionRate: link.commissionRate,
    pendingCommissionsUsd: link.pendingCommissionsUsd,
    paidCommissionsUsd: link.paidCommissionsUsd,
  };
}
