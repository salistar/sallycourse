import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { AccountManager } from './account-manager';

/**
 * Réglages → Compte (P66, RGPD) : export des données (portabilité) et
 * suppression définitive du compte (droit à l'effacement). Actions
 * en self-service, sans intervention du support.
 */

export const metadata: Metadata = {
  title: 'Compte — SallyCourse',
  description: 'Exportez vos données ou supprimez définitivement votre compte SallyCourse.',
};

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Compte</h1>
        <p className="max-w-2xl text-muted">
          Gérez vos données personnelles conformément au RGPD : téléchargez une copie complète de
          vos données, ou supprimez définitivement votre compte SallyCourse.
        </p>
      </header>

      <AccountManager email={user.email ?? ''} />
    </div>
  );
}
