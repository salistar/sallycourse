'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { useDesignSettings } from './design-context';
import { GrainOverlay } from './grain';

/**
 * Cadre de démonstration : applique le sens de lecture choisi dans la barre
 * de contrôle (LTR/RTL) et le voile de grain photographique optionnel.
 * Chaque section du styleguide pose ses exemples dans ce cadre pour être
 * observable en light / dark / RTL sans recharger la page.
 */
export function PreviewFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { dir, grain } = useDesignSettings();

  return (
    <div
      dir={dir}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border/70 bg-surface-subtle/40 p-6 sm:p-8',
        className,
      )}
    >
      <div className="relative z-10">{children}</div>
      {grain ? <GrainOverlay intensity={0.22} /> : null}
    </div>
  );
}
