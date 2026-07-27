import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connectDb, Course } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { CouponsManager } from './coupons-manager';

/**
 * Réglages → Coupons (P139) : gestion des codes promo du créateur. L'API
 * complète (GET/POST /api/coupons, DELETE /api/coupons/[id]) existait sans
 * aucune page UI — audit connectivité 2026-07-17.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.couponsPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function CouponsSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.couponsPage');

  // Cours du créateur — pour cibler un coupon sur un cours et suggérer un
  // calendrier promo (P139). Ne remonte que id + titre (léger).
  await connectDb();
  const courses = await Course.find({ userId: user.id })
    .select('title')
    .sort({ createdAt: -1 })
    .lean();
  const courseOptions = courses.map((c) => ({ id: String(c._id), title: c.title }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('intro')}</p>
      </header>
      <CouponsManager courses={courseOptions} />
    </div>
  );
}
