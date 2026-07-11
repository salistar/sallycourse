import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { VoiceCloneManager } from './voice-clone-manager';

/**
 * Réglages → Ma voix (P81) : clonage de la voix de l'instructeur (ElevenLabs
 * Voice Cloning) pour narrer les cours vidéo avec sa propre voix.
 */

export const metadata: Metadata = {
  title: 'Ma voix — SallyCourse',
  description: 'Clonez votre voix pour narrer vos cours vidéo avec votre propre timbre.',
};

export const dynamic = 'force-dynamic';

export default async function VoiceSettingsPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Ma voix</h1>
        <p className="max-w-2xl text-muted">
          Gérez le clonage vocal utilisé pour la narration de vos cours vidéo.
        </p>
      </header>

      <VoiceCloneManager />
    </div>
  );
}
