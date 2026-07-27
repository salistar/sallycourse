import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { VoiceCloneManager } from './voice-clone-manager';

/**
 * Réglages → Ma voix (P81) : clonage de la voix de l'instructeur (ElevenLabs
 * Voice Cloning) pour narrer les cours vidéo avec sa propre voix.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.voicePage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function VoiceSettingsPage() {
  await requireUser();
  const t = await getTranslations('settings.voicePage');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      <VoiceCloneManager />
    </div>
  );
}
