'use client';

import * as React from 'react';
import { PendingButton } from '@/components/admin';
import { Input } from '@/components/ui';

/**
 * Formulaire de rejet avec motif libre (Prompt 158) : bascule un champ texte
 * visible seulement après un premier clic, pour ne pas alourdir la ligne de
 * table par défaut.
 */
export function RejectForm({
  requestId,
  action,
}: {
  requestId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-muted transition-colors duration-fast hover:bg-surface hover:text-foreground"
      >
        Rejeter
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Input
        name="reason"
        label="Motif (optionnel)"
        wrapperClassName="w-40"
        className="h-9 py-1.5 text-sm"
      />
      <PendingButton variant="ghost" size="sm">
        Confirmer
      </PendingButton>
    </form>
  );
}
