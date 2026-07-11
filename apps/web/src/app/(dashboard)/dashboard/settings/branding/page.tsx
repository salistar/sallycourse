import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { BrandingManager } from './branding-manager';

/**
 * Réglages → Marque blanche (Prompt 88, plan Business) : logo + couleurs de
 * l'école appliqués au certificat PDF à la place de SALISTAR par défaut.
 */

export const metadata: Metadata = {
  title: 'Marque blanche — SallyCourse',
  description: 'Personnalisez le certificat de vos étudiants avec le logo et les couleurs de votre école.',
};

export const dynamic = 'force-dynamic';

export default async function BrandingSettingsPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Marque blanche</h1>
        <p className="max-w-2xl text-muted">
          Remplacez la marque SALISTAR par le logo et les couleurs de votre école sur le certificat
          de complétion délivré à vos étudiants.
        </p>
      </header>

      <BrandingManager userPlan={user.plan ?? 'free'} />
    </div>
  );
}
