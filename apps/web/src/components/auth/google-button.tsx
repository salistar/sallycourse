'use client';

import * as React from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui';

/** Glyphe « G » monochrome (currentColor — aucune couleur inline). */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}

interface GoogleButtonProps {
  /** Destination après connexion réussie. */
  callbackUrl: string;
  label?: string;
}

/** Bouton de connexion Google — déclenche le flux OAuth Auth.js. */
export function GoogleButton({ callbackUrl, label = 'Continuer avec Google' }: GoogleButtonProps) {
  const [loading, setLoading] = React.useState(false);

  return (
    <Button
      variant="secondary"
      className="w-full"
      loading={loading}
      onClick={() => {
        setLoading(true);
        void signIn('google', { redirectTo: callbackUrl });
      }}
    >
      {!loading && <GoogleGlyph />}
      {label}
    </Button>
  );
}
