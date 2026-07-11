'use client';

import * as React from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast, type BadgeProps } from '@/components/ui';
import type { DubbedVersionView, Locale } from './types';

/**
 * « Traduire ce cours » (Prompt 92) — pour un cours déjà déployé : sélection
 * multi-langues, doublage optionnel (nouveau TTS + MP4), lancement via la
 * queue 'deployment' (action 'translate'). Affiche l'état des versions déjà
 * traduites/doublées (Course.dubbedVersions), rafraîchi après lancement.
 */

export interface TranslatePanelProps {
  courseId: string;
  /** Langue source du cours — jamais proposée comme cible. */
  sourceLocale: Locale;
  dubbedVersions: DubbedVersionView[];
}

const ALL_LOCALES: Locale[] = ['fr', 'en', 'ar'];

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

const STATUS_BADGE: Record<DubbedVersionView['status'], { variant: NonNullable<BadgeProps['variant']>; label: string }> = {
  pending: { variant: 'draft', label: 'En file' },
  generating: { variant: 'generating', label: 'En cours' },
  ready: { variant: 'ready', label: 'Prêt' },
  failed: { variant: 'failed', label: 'Échec partiel' },
};

export function TranslatePanel({ courseId, sourceLocale, dubbedVersions: initial }: TranslatePanelProps) {
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Set<Locale>>(new Set());
  const [dub, setDub] = React.useState(false);
  const [launching, setLaunching] = React.useState(false);
  const [versions, setVersions] = React.useState<DubbedVersionView[]>(initial);

  const targetLocales = React.useMemo(
    () => ALL_LOCALES.filter((l) => l !== sourceLocale),
    [sourceLocale],
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/translate`);
      if (!res.ok) return;
      const data = (await res.json()) as { dubbedVersions?: DubbedVersionView[] };
      if (Array.isArray(data.dubbedVersions)) setVersions(data.dubbedVersions);
    } catch {
      // Snapshot best-effort : la liste reste celle du dernier chargement réussi.
    }
  }, [courseId]);

  function toggle(locale: Locale): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(locale)) next.delete(locale);
      else next.add(locale);
      return next;
    });
  }

  async function launch(): Promise<void> {
    if (selected.size === 0) return;
    setLaunching(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locales: [...selected], dub }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: 'Traduction impossible', description: data?.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Traduction lancée',
        description: `${selected.size} langue(s)${dub ? ' avec doublage' : ' (sous-titres uniquement)'}.`,
      });
      setSelected(new Set());
      await refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setLaunching(false);
    }
  }

  if (targetLocales.length === 0) return null;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Localisation</p>
          <CardTitle className="mt-0.5 flex items-center gap-2 text-lg">
            <Languages className="size-5 text-accent" aria-hidden="true" />
            Traduire ce cours
          </CardTitle>
        </div>
        <p className="text-sm text-muted">
          Traduit les sous-titres existants dans les langues sélectionnées et met à jour les
          plateformes déjà déployées. Le doublage régénère aussi l'audio et la vidéo (plus long).
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2.5">
          {targetLocales.map((locale) => {
            const active = selected.has(locale);
            return (
              <button
                key={locale}
                type="button"
                onClick={() => toggle(locale)}
                aria-pressed={active}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-fast ${
                  active
                    ? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary/30'
                    : 'border-border bg-surface text-muted hover:border-ring/50'
                }`}
              >
                {LOCALE_LABELS[locale] ?? locale}
              </button>
            );
          })}
        </div>

        <label className="flex items-start gap-3 rounded-md border border-border bg-surface-subtle p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={dub}
            onChange={(e) => setDub(e.target.checked)}
          />
          <span>
            <span className="font-medium text-foreground">Doubler les vidéos (audio + montage régénérés).</span>{' '}
            <span className="text-muted">
              Sans cette option, seuls les sous-titres sont traduits (plus rapide, moins coûteux).
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={launching}
            disabled={selected.size === 0}
            onClick={() => void launch()}
          >
            {!launching && <Languages aria-hidden="true" />}
            Traduire ({selected.size || 0})
          </Button>
        </div>

        {versions.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Versions existantes</p>
            {versions.map((v) => {
              const badge = STATUS_BADGE[v.status];
              return (
                <div
                  key={v.locale}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-center gap-2">
                    {v.status === 'generating' && (
                      <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden="true" />
                    )}
                    <span className="font-medium text-foreground">{LOCALE_LABELS[v.locale] ?? v.locale}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-2xs text-muted">
                    {v.lessonsWithSubtitles} sous-titre(s) · {v.lessonsWithVideo} vidéo(s) doublée(s)
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
