import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { BrandingManager } from './branding-manager';

/**
 * Réglages → Marque blanche (Prompt 88, plan Business) : logo + couleurs de
 * l'école appliqués au certificat PDF à la place de SALISTAR par défaut.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.brandingPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function BrandingSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.brandingPage');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      <BrandingManager userPlan={user.plan ?? 'free'} />
    </div>
  );
}
