'use client';

import * as React from 'react';
import { BookOpen, ChevronDown, ExternalLink, FileText, NotebookPen } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { CourseResourcesView } from './types';

/**
 * Section « Ressources » (Prompt 65) — cheat sheet et workbook PDF
 * téléchargeables (URLs présignées, générées en fin de pipeline), suivis du
 * glossaire des termes clés et de la liste « pour aller plus loin ». Repliée
 * par défaut (contenu secondaire, consulté après la leçon).
 */

export interface ResourcesPanelProps {
  resources: CourseResourcesView | null | undefined;
}

export function ResourcesPanel({ resources }: ResourcesPanelProps) {
  const [open, setOpen] = React.useState(false);
  const contentId = React.useId();

  if (!resources) return null;

  const { glossary, furtherResources, cheatsheetUrl, workbookUrl } = resources;

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition-colors duration-fast hover:bg-muted/5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <BookOpen className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-medium text-foreground">Ressources</span>
            <span className="block text-xs text-muted">
              Aide-mémoire, workbook, glossaire ({glossary.length}) et liens utiles (
              {furtherResources.length})
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-muted transition-transform duration-base',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={contentId} className="flex flex-col gap-6 border-t border-border p-4">
          {/* ── Téléchargements PDF ─────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {cheatsheetUrl ? (
              <a
                href={cheatsheetUrl}
                download
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <FileText aria-hidden="true" />
                Aide-mémoire (PDF)
              </a>
            ) : null}
            {workbookUrl ? (
              <a
                href={workbookUrl}
                download
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <NotebookPen aria-hidden="true" />
                Workbook des TP (PDF)
              </a>
            ) : null}
          </div>

          {/* ── Glossaire ────────────────────────────────────────── */}
          {glossary.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Glossaire</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                {glossary.map((entry) => (
                  <div key={entry.term} className="rounded-md border border-border bg-background p-3">
                    <dt className="text-sm font-medium text-foreground">{entry.term}</dt>
                    <dd className="mt-1 text-sm text-muted">{entry.definition}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* ── Pour aller plus loin ─────────────────────────────── */}
          {furtherResources.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Pour aller plus loin</h3>
              <ul className="flex flex-col gap-2">
                {furtherResources.map((resource) => (
                  <li
                    key={resource.title}
                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{resource.title}</span>
                        <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted">
                          {resource.kind}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm text-muted">{resource.description}</span>
                    </span>
                    {resource.url ? (
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="shrink-0 text-muted transition-colors duration-fast hover:text-primary"
                        aria-label={`Ouvrir « ${resource.title} »`}
                      >
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
