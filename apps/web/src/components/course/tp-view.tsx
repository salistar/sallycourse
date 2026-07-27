'use client';

import { useTranslations } from 'next-intl';
import { Target, Terminal } from 'lucide-react';
import type { TpContentView } from './types';

/**
 * Rendu en lecture (non éditable) d'un TP structuré — objectif,
 * environnement, étapes (instruction/commande/résultat attendu), validation,
 * dépannage (Lot 5, plan 2026-07-20). Les captures d'écran par étape
 * s'affichent séparément (ScreenshotGallery, onglet dédié).
 */
export interface TpViewProps {
  tp: TpContentView;
}

export function TpView({ tp }: TpViewProps) {
  const t = useTranslations('course.editor.tp');

  return (
    <div className="flex flex-col gap-6 text-sm text-foreground">
      <section className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Target className="size-3.5" aria-hidden="true" />
          {t('objective')}
        </h3>
        <p className="leading-relaxed">{tp.objective}</p>
      </section>

      {tp.environment.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('environment')}</h3>
          <ul className="m-0 list-disc space-y-1 ps-5">
            {tp.environment.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">
          {t('steps', { count: tp.steps.length })}
        </h3>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {tp.steps.map((step, index) => (
            <li key={index} className="rounded-md border border-border bg-surface-subtle/40 p-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('stepLabel', { number: index + 1 })}
              </p>
              <p className="mt-1 leading-relaxed">{step.instruction}</p>
              {step.command && (
                <p className="mt-2 flex items-center gap-1.5 rounded-sm bg-neutral-950 px-2.5 py-1.5 font-mono text-xs text-neutral-100">
                  <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
                  {step.command}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                <span className="font-semibold">{t('expectedResult')} : </span>
                {step.expectedResult}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {tp.validation.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('validation')}</h3>
          <ul className="m-0 list-disc space-y-1 ps-5">
            {tp.validation.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {tp.troubleshooting.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('troubleshooting')}</h3>
          <ul className="m-0 list-disc space-y-1 ps-5">
            {tp.troubleshooting.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
