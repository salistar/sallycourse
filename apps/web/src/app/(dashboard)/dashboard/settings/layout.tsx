import type { ReactNode } from 'react';
import { SettingsNav } from '@/components/settings/settings-nav';

/**
 * Layout des Réglages — sous-navigation persistante vers les 10 sections.
 * Sans elle, 8 sections livrées (dont « Ma voix » — clonage vocal — et « Mon
 * avatar » — Ditto) étaient inaccessibles depuis l'UI (audit connectivité
 * 2026-07-17) : seules /settings → account et billing étaient atteignables.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav />
      <div>{children}</div>
    </div>
  );
}
