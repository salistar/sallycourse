'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Users } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';

/**
 * Bandeau d'approbation d'équipe (Prompt 138) — affiché uniquement pour un
 * cours rattaché à un Workspace dont au moins un reviewer existe. Montre le
 * statut d'approbation courant et laisse un owner/reviewer approuver en un
 * clic (le déploiement reste bloqué côté API tant que non approuvé).
 */

export interface TeamApprovalBannerProps {
  courseId: string;
  role: 'owner' | 'editor' | 'reviewer';
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export function TeamApprovalBanner({ courseId, role, approvedBy, approvedAt }: TeamApprovalBannerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [approving, setApproving] = React.useState(false);

  const canApprove = role === 'owner' || role === 'reviewer';
  const approved = Boolean(approvedBy);

  const approve = async () => {
    setApproving(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/approve-deploy`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: 'Cours approuvé',
          description: 'Le déploiement est maintenant autorisé pour cette version.',
          variant: 'success',
        });
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
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
        variant: 'danger',
      });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Users className="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Validation d'équipe requise avant déploiement</p>
          <p className="text-xs text-muted">
            {approved ? (
              <>
                Approuvé le{' '}
                {approvedAt
                  ? new Date(approvedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
                  : ''}
                .
              </>
            ) : (
              "Un relecteur (reviewer) ou le propriétaire de l'équipe doit approuver cette version."
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={approved ? 'ready' : 'draft'} hideDot={false}>
          {approved ? 'Approuvé' : 'En attente'}
        </Badge>
        {!approved && canApprove && (
          <Button variant="secondary" size="sm" loading={approving} onClick={approve}>
            {!approving && <ShieldCheck aria-hidden="true" />}
            Approuver
          </Button>
        )}
      </div>
    </div>
  );
}
