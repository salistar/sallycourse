import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { type PlanId } from '@sallycourse/shared';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { getQuotaState } from '@/lib/quota';
import { BatchExperience } from '@/components/batch/batch-experience';

/**
 * /dashboard/batch — génération en lot depuis un CSV (P63).
 * Page serveur : lit le plan + quota restant de l'utilisateur (pour l'aperçu et
 * le garde-fou côté client) et délègue l'UX au composant client.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('batch.page');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

const PLAN_LABEL_KEYS: Record<PlanId, string> = {
  free: 'planFree',
  pro: 'planPro',
  business: 'planBusiness',
};

export default async function BatchPage() {
  const t = await getTranslations('batch.page');
  const user = await requireUser();
  await connectDb();

  const userDoc = await UserModel.findById(user.id).select('plan quotaUsed').lean();
  const plan = (userDoc?.plan ?? 'free') as PlanId;
  const quota = getQuotaState(userDoc ?? { plan });

  // Infinity (business) → null côté client pour signifier « illimité ».
  const remaining = Number.isFinite(quota.remaining) ? quota.remaining : null;

  return <BatchExperience remaining={remaining} planLabel={t(PLAN_LABEL_KEYS[plan])} />;
}
