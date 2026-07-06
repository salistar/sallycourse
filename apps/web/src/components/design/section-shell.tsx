import * as React from 'react';

/**
 * Coquille de section du styleguide : numéro d'acte doré (clin d'œil
 * « studio de production »), titre en Fraunces, filet dégradé et chapô.
 */
export function StyleSection({
  id,
  index,
  title,
  lead,
  children,
}: {
  /** Ancre de navigation (#palette, #typographie…). */
  id: string;
  /** Numéro d'ordre affiché « 01 », « 02 »… */
  index: number;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex scroll-mt-28 flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline gap-4">
          <span aria-hidden="true" className="font-display text-lg font-medium text-accent">
            {String(index).padStart(2, '0')}
          </span>
          <h2 id={`${id}-titre`} className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
            {title}
          </h2>
          {/* Fin liseré dégradé violet → or — usage décoratif autorisé */}
          <div
            aria-hidden="true"
            className="hidden h-px flex-1 self-center bg-gradient-to-r from-primary-500/40 via-border to-accent-400/30 sm:block"
          />
        </div>
        <p className="max-w-2xl text-base text-muted">{lead}</p>
      </header>
      {children}
    </section>
  );
}

/** Légende discrète posée au-dessus d'un exemple. */
export function ExampleLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{children}</span>
  );
}
