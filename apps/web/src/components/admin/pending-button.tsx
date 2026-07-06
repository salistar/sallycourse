'use client';

import * as React from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui';

/**
 * Bouton de soumission pour formulaires à action serveur : affiche le
 * spinner du Button pendant que l'action est en vol (useFormStatus).
 */
export function PendingButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}
