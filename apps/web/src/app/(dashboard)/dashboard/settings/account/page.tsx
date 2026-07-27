import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { getTranslations } from 'next-intl/server';
import { AccountManager } from './account-manager';

/**
 * Réglages → Compte (P66, RGPD) : export des données (portabilité) et
 * suppression définitive du compte (droit à l'effacement). Actions
 * en self-service, sans intervention du support.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.accountPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.accountPage');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
        <Link
          href="/dashboard/settings/activity"
          className="text-sm font-medium text-primary-400 underline-offset-2 hover:underline"
        >
          {t('activityLink')}
        </Link>
      </header>

      <AccountManager email={user.email ?? ''} />
    </div>
  );
}
