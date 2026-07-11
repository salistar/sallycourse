'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import type { VideoQualityStatus } from './types';

/**
 * Statut du brouillon d'une leçon vidéo (Prompt 133) — affiché à côté du
 * badge de statut de génération existant. 'none' : rien à montrer (aucun
 * effet visuel pour les cours qui n'utilisent pas l'aperçu rapide).
 */
export interface ApprovePreviewButtonProps {
  lessonId: string;
  videoQualityStatus?: VideoQualityStatus;
}

export function ApprovePreviewButton({ lessonId, videoQualityStatus }: ApprovePreviewButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const status = videoQualityStatus ?? 'none';
  if (status === 'none') return null;

  const approve = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/approve-preview`, { method: 'POST' });
      if (res.ok) {
        toast({ title: 'Aperçu approuvé', description: 'Prêt pour la version finale HD.', variant: 'success' });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Approbation impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: 'Erreur réseau', description: 'Impossible de joindre le serveur.', variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  if (status === 'draft-ready') {
    return (
      <Button variant="secondary" size="sm" loading={loading} onClick={approve}>
        <CheckCircle2 aria-hidden="true" />
        Approuver l&apos;aperçu
      </Button>
    );
  }

  if (status === 'approved') {
    return <Badge variant="draft">Aperçu approuvé</Badge>;
  }

  if (status === 'final-ready') {
    return <Badge variant="ready">HD livrée</Badge>;
  }

  return null;
}
