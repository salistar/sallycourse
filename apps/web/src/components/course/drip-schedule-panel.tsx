'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { CalendarClock, Pause, Play, Rocket, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Select,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import type { DripCadence } from '@sallycourse/shared/deploy-schedule';

/**
 * Déploiements programmés « drip » (P181) — calendrier interactif de publication
 * étalée. Pour chaque plateforme cible, l'auteur choisit une cadence (immédiat,
 * N par semaine, ou N par jour pendant M jours), programme le plan (POST), puis
 * suit son avancement (prochaines échéances, éléments publiés) avec des contrôles
 * Pause / Reprendre / Annuler câblés sur les routes. Le worker exécute le cron.
 */

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type CadenceKind = 'immediate' | 'per-week' | 'per-day';

interface DraftCadence {
  enabled: boolean;
  kind: CadenceKind;
  count: number;
  days: number;
}

interface ScheduleEntrySnapshot {
  platform: string;
  cadence: DripCadence;
  cadenceLabel: string;
  cursor: number;
  nextRunAt: number | null;
  completed: boolean;
}

interface ScheduleSnapshot {
  status: 'active' | 'paused' | 'completed';
  updatedAt?: number;
  entries: ScheduleEntrySnapshot[];
}

export interface DripSchedulePanelProps {
  courseId: string;
  /** Plateformes proposables : id + libellé (catalogue de déploiement + clips courts). */
  platforms: { id: string; label: string }[];
}

const KIND_LABEL_KEY: Record<CadenceKind, string> = {
  immediate: 'kindImmediate',
  'per-week': 'kindPerWeek',
  'per-day': 'kindPerDay',
};

const STATUS_BADGE: Record<ScheduleSnapshot['status'], { variant: 'published' | 'draft' | 'generating'; labelKey: string }> = {
  active: { variant: 'generating', labelKey: 'statusActive' },
  paused: { variant: 'draft', labelKey: 'statusPaused' },
  completed: { variant: 'published', labelKey: 'statusCompleted' },
};

/* ------------------------------------------------------------------ */
/* Composant                                                            */
/* ------------------------------------------------------------------ */

export function DripSchedulePanel({ courseId, platforms }: DripSchedulePanelProps) {
  const { toast } = useToast();
  const t = useTranslations('course.drip');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const [drafts, setDrafts] = React.useState<Record<string, DraftCadence>>({});
  const [snapshot, setSnapshot] = React.useState<ScheduleSnapshot | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const labelOf = React.useCallback(
    (id: string) => platforms.find((p) => p.id === id)?.label ?? id,
    [platforms],
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy-schedule`);
      if (!res.ok) return;
      const data = (await res.json()) as { schedule?: ScheduleSnapshot | null };
      setSnapshot(data.schedule ?? null);
    } catch {
      // Best-effort : la section reste dans son dernier état connu.
    }
  }, [courseId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /** État de brouillon d'une plateforme (valeurs par défaut si absente). */
  const draftOf = React.useCallback(
    (id: string): DraftCadence => drafts[id] ?? { enabled: false, kind: 'immediate', count: 1, days: 30 },
    [drafts],
  );

  function patchDraft(id: string, patch: Partial<DraftCadence>): void {
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id), ...patch } }));
  }

  /** Entrées activées → payload cadence conforme au schéma partagé. */
  const selectedEntries = React.useMemo(
    () =>
      platforms
        .map((p) => ({ platform: p.id, draft: draftOf(p.id) }))
        .filter((e) => e.draft.enabled),
    [platforms, drafts, draftOf],
  );

  function toCadence(draft: DraftCadence): DripCadence {
    if (draft.kind === 'per-week') return { kind: 'per-week', count: Math.max(1, draft.count) };
    if (draft.kind === 'per-day') return { kind: 'per-day', count: Math.max(1, draft.count), days: Math.max(1, draft.days) };
    return { kind: 'immediate' };
  }

  async function schedule(): Promise<void> {
    if (selectedEntries.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: selectedEntries.map((e) => ({ platform: e.platform, cadence: toCadence(e.draft) })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('scheduleErrorTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({
        variant: 'success',
        title: t('scheduledTitle'),
        description: t('scheduledDescription', { count: selectedEntries.length }),
      });
      setDrafts({});
      await refresh();
    } catch {
      toast({ variant: 'danger', title: t('networkErrorTitle'), description: t('networkErrorDescription') });
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    setActing(action);
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy-schedule/${action}`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('actionErrorTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      const labels: Record<typeof action, string> = {
        pause: 'toastPaused',
        resume: 'toastResumed',
        cancel: 'toastCancelled',
      };
      toast({ variant: 'success', title: t(labels[action]) });
      if (action === 'cancel') setSnapshot(null);
      else await refresh();
    } catch {
      toast({ variant: 'danger', title: t('networkErrorTitle'), description: t('networkErrorDescription') });
    } finally {
      setActing(null);
    }
  }

  const hasPlan = snapshot !== null && snapshot.entries.length > 0;

  return (
    <div className="rounded-md border border-border bg-surface-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-3 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarClock className="size-4 text-accent" aria-hidden="true" />
          {t('title')}
          {hasPlan && (
            <Badge variant={STATUS_BADGE[snapshot!.status].variant} hideDot className="text-2xs">
              {t(STATUS_BADGE[snapshot!.status].labelKey)}
            </Badge>
          )}
        </span>
        <span className="text-2xs text-muted">{open ? t('hide') : t('configure')}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <p className="text-2xs text-muted">{t('intro')}</p>

          {/* ── Plan en cours ───────────────────────────────────── */}
          {hasPlan && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('currentPlan')}</p>
                <div className="flex items-center gap-1.5">
                  {snapshot!.status === 'active' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={acting === 'pause'}
                      disabled={acting !== null}
                      onClick={() => void runAction('pause')}
                    >
                      {acting !== 'pause' && <Pause aria-hidden="true" />}
                      {t('pause')}
                    </Button>
                  )}
                  {snapshot!.status === 'paused' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={acting === 'resume'}
                      disabled={acting !== null}
                      onClick={() => void runAction('resume')}
                    >
                      {acting !== 'resume' && <Play aria-hidden="true" />}
                      {t('resume')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={acting === 'cancel'}
                    disabled={acting !== null}
                    onClick={() => void runAction('cancel')}
                  >
                    {acting !== 'cancel' && <Trash2 aria-hidden="true" />}
                    {t('cancel')}
                  </Button>
                </div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {snapshot!.entries.map((e) => (
                  <li
                    key={e.platform}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-subtle px-2.5 py-1.5 text-sm"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{labelOf(e.platform)}</span>
                      <Badge variant="draft" hideDot className="text-2xs">
                        {e.cadenceLabel}
                      </Badge>
                      {e.completed && (
                        <Badge variant="published" hideDot className="text-2xs">
                          {t('completed')}
                        </Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-3 text-2xs text-muted">
                      <span className="tabular-nums">{t('publishedCount', { count: e.cursor })}</span>
                      {!e.completed && e.nextRunAt && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3" aria-hidden="true" />
                          {format.dateTime(new Date(e.nextRunAt), {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Constructeur de plan ────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
              {hasPlan ? t('reschedule') : t('schedule')}
            </p>
            <div className="flex flex-col gap-2">
              {platforms.map((p) => {
                const draft = draftOf(p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-md border p-2.5 transition-colors',
                      draft.enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-surface',
                    )}
                  >
                    <label className="flex items-center gap-2.5 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={draft.enabled}
                        onChange={(e) => patchDraft(p.id, { enabled: e.target.checked })}
                      />
                      <span className="font-medium">{p.label}</span>
                    </label>

                    {draft.enabled && (
                      <div className="mt-2 flex flex-wrap items-end gap-2 pl-6">
                        <Select
                          aria-label={t('cadenceFor', { platform: p.label })}
                          value={draft.kind}
                          onChange={(e) => patchDraft(p.id, { kind: e.target.value as CadenceKind })}
                          wrapperClassName="w-56"
                        >
                          {(Object.keys(KIND_LABEL_KEY) as CadenceKind[]).map((k) => (
                            <option key={k} value={k}>
                              {t(KIND_LABEL_KEY[k])}
                            </option>
                          ))}
                        </Select>
                        {draft.kind !== 'immediate' && (
                          <Input
                            label={draft.kind === 'per-week' ? t('countPerWeek') : t('countPerDay')}
                            type="number"
                            min={1}
                            max={1000}
                            value={draft.count}
                            onChange={(e) => patchDraft(p.id, { count: Number(e.target.value) || 1 })}
                            wrapperClassName="w-28"
                          />
                        )}
                        {draft.kind === 'per-day' && (
                          <span className="flex items-end gap-2">
                            <span className="pb-4 text-2xs text-muted">{t('during')}</span>
                            <Input
                              label={t('days')}
                              type="number"
                              min={1}
                              max={365}
                              value={draft.days}
                              onChange={(e) => patchDraft(p.id, { days: Number(e.target.value) || 1 })}
                              wrapperClassName="w-24"
                            />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-1 flex items-center justify-end">
              <Button
                variant="gold"
                size="sm"
                loading={saving}
                disabled={selectedEntries.length === 0 || saving}
                onClick={() => void schedule()}
              >
                {!saving && <Rocket aria-hidden="true" />}
                {hasPlan ? t('reschedule') : t('schedule')} ({selectedEntries.length})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
