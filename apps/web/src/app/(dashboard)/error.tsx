'use client';

import * as React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui';

/**
 * Error boundary générique du groupe (dashboard) — Next 15 App Router monte
 * ce composant pour toute erreur non catchée levée par un Server/Client
 * Component d'une page sous /dashboard ou /admin (segment error.tsx couvre
 * tout le sous-arbre, layout.tsx du groupe compris). `reset()` retente le
 * rendu du segment sans recharger toute la page.
 *
 * `console.error` (et non le logger pino serveur) : ce composant s'exécute
 * côté client, le logger structuré `@/lib/logger` n'est pas utilisable ici.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error('[dashboard] erreur non gérée :', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </div>
          <CardTitle>Une erreur est survenue</CardTitle>
          <CardDescription>
            Ce n&rsquo;était pas prévu. Réessayez — si le problème persiste, revenez plus tard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Button onClick={() => reset()} className="gap-2">
            <RotateCw className="size-4" aria-hidden="true" />
            Réessayer
          </Button>
          {error.digest && <p className="text-xs text-muted">Référence : {error.digest}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
