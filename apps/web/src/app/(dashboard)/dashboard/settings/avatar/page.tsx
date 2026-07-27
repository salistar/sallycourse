import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { getTranslations } from 'next-intl/server';
import { AvatarFaceManager } from './avatar-face-manager';

/**
 * Réglages → Mon avatar : photo de présentateur animée en « talking-head »
 * (Ditto/Modal) pour introduire/conclure les sections des cours vidéo.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.avatarPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function AvatarSettingsPage() {
  await requireUser();
  const t = await getTranslations('settings.avatarPage');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">
          {t('description')}
        </p>
      </header>

      <AvatarFaceManager />
    </div>
  );
}
