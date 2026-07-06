'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@/components/ui';

/**
 * Dialogue « Régénérer le plan » : consignes libres optionnelles envoyées au
 * worker outline ({ extraInstructions }). La soumission est déléguée au parent.
 */

export interface RegenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (extraInstructions: string) => void;
  /** Régénération en cours (spinner + champs neutralisés). */
  pending: boolean;
}

const MAX_INSTRUCTIONS_CHARS = 2000;

export function RegenerateDialog({ open, onOpenChange, onConfirm, pending }: RegenerateDialogProps) {
  const [instructions, setInstructions] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Régénérer le plan</DialogTitle>
          <DialogDescription>
            Le plan actuel (et vos modifications) sera remplacé par une nouvelle proposition.
            Ajoutez des consignes pour orienter la nouvelle version.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <Textarea
            label="Instructions supplémentaires (optionnel)"
            value={instructions}
            maxLength={MAX_INSTRUCTIONS_CHARS}
            onChange={(event) => setInstructions(event.target.value)}
            disabled={pending}
            rows={4}
            hint="Ex. : « Plus de travaux pratiques, une section dédiée au déploiement, niveau plus progressif. »"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="primary" loading={pending} onClick={() => onConfirm(instructions.trim())}>
            {!pending && <RefreshCw aria-hidden="true" />}
            Régénérer le plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
