'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button, useToast } from '@/components/ui';

/**
 * « Régénérer la leçon » — POST /api/lessons/[id]/regenerate puis refresh
 * du Server Component pour refléter le passage en 'generating'.
 */
export interface RegenerateButtonProps {
  lessonId: string;
  lessonTitle: string;
  /** Leçon déjà en cours de génération : action neutralisée. */
  disabled?: boolean;
}

export function RegenerateButton({ lessonId, lessonTitle, disabled = false }: RegenerateButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const regenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: 'Régénération lancée',
          description: `« ${lessonTitle} » repart en production.`,
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Régénération impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      disabled={disabled}
      onClick={regenerate}
      title={disabled ? 'Génération déjà en cours' : undefined}
    >
      {!loading && <RefreshCw aria-hidden="true" />}
      Régénérer la leçon
    </Button>
  );
}
