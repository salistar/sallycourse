'use client';

/**
 * UmamiScript — tracking d'audience OSS self-hosté (P157).
 * No-op tant que NEXT_PUBLIC_UMAMI_WEBSITE_ID n'est pas configuré (dev,
 * previews, self-host sans le profil docker-compose `monitoring`) : ne
 * rend rien, n'injecte aucun script. Pas de cookie tiers, RGPD par défaut.
 *
 * Placé dans le layout racine (app/layout.tsx), en dehors de tout Provider —
 * composant client minimal, ne consomme que des variables NEXT_PUBLIC_*.
 */

import Script from 'next/script';
import { resolveUmamiConfig } from './umami-config';

export function UmamiScript(): React.ReactElement | null {
  const config = resolveUmamiConfig();
  if (!config) return null;

  return (
    <Script
      src={config.src}
      data-website-id={config.websiteId}
      strategy="afterInteractive"
      defer
    />
  );
}
