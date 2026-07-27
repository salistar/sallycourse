'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileUp, Play, RotateCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  useToast,
} from '@/components/ui';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { parseBatchCsv, type ParsedBatch } from '@/lib/batch-csv';
import { errorMessage } from '@/lib/error-message';

/**
 * Expérience de génération en batch (P63) — import CSV → aperçu → lancement →
 * suivi groupé. Le parsing est réutilisé côté client (même module que l'API)
 * pour un aperçu instantané ; l'API refait la validation autoritative + quota.
 */

interface BatchExperienceProps {
  /** Crédits restants ce mois (Infinity encodé par null → illimité). */
  remaining: number | null;
  planLabel: string;
}

/** Ligne de suivi d'un cours créé. */
interface TrackedCourse {
  id: string;
  title: string;
  status: string;
  step: string | null;
  progress: number;
}

/** États terminaux : plus besoin de continuer le polling. */
const TERMINAL_STATUSES = new Set(['ready', 'published', 'failed']);

/** Mappe un statut de cours vers une variante de Badge. */
function statusBadgeVariant(status: string): 'generating' | 'ready' | 'failed' | 'published' | 'draft' {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'published':
      return 'published';
    case 'failed':
      return 'failed';
    case 'generating':
      return 'generating';
    // 'outline-review' = le plan attend une action de l'auteur : badge neutre
    // (pas la pastille pulsée « en cours ») pour signaler qu'il faut agir.
    case 'outline-review':
      return 'draft';
    default:
      return 'draft';
  }
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'status.draft',
  generating: 'status.generating',
  'outline-review': 'status.outlineReview',
  ready: 'status.ready',
  published: 'status.published',
  failed: 'status.failed',
};

/** Exemple de CSV proposé au téléchargement (gabarit). */
const SAMPLE_CSV = [
  'title,level,language,platforms',
  'Maîtriser Docker de zéro,beginner,fr,udemy;youtube',
  'React avancé et performance,advanced,fr,udemy',
  'Introduction to SQL,beginner,en,',
].join('\n');

export function BatchExperience({ remaining, planLabel }: BatchExperienceProps) {
  const { toast } = useToast();
  const t = useTranslations('batch');
  const tApiError = useTranslations('apiErrors');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ParsedBatch | null>(null);
  const [rawCsv, setRawCsv] = React.useState<string>('');
  const [launching, setLaunching] = React.useState(false);
  const [tracked, setTracked] = React.useState<TrackedCourse[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const unlimited = remaining === null;
  const validCount = preview?.valid.length ?? 0;
  const overQuota = !unlimited && remaining !== null && validCount > remaining;

  /** Lit un fichier CSV et calcule l'aperçu local. */
  const handleFile = React.useCallback(
    async (file: File) => {
      const text = await file.text();
      setRawCsv(text);
      setFileName(file.name);
      const result = parseBatchCsv(text);
      setPreview(result);
      setTracked([]);
      if (result.fatal) {
        toast({ title: t('toast.invalidCsv'), description: result.fatal, variant: 'danger' });
      }
    },
    [toast],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  /** Télécharge le gabarit CSV d'exemple. */
  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sallycourse-batch.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Envoie le CSV à l'API, initialise le suivi. */
  const launch = async () => {
    if (!rawCsv || validCount === 0) return;
    setLaunching(true);
    try {
      const res = await fetch('/api/courses/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: rawCsv }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: t('toast.rejected'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
        return;
      }

      const created: TrackedCourse[] = (data.created ?? []).map(
        (c: { id: string; title: string; status: string }) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          step: null,
          progress: 0,
        }),
      );
      setTracked(created);
      setPreview(null);
      setFileName(null);
      setRawCsv('');

      const failedCount = (data.failed?.length ?? 0) + (data.invalid?.length ?? 0);
      toast({
        title: t('toast.launched.title', { count: created.length }),
        description:
          failedCount > 0
            ? t('toast.launched.skipped', { count: failedCount })
            : t('toast.launched.inProgress'),
        variant: created.length > 0 ? 'success' : 'warning',
      });
    } catch {
      toast({ title: t('toast.networkError.title'), description: t('toast.networkError.description'), variant: 'danger' });
    } finally {
      setLaunching(false);
    }
  };

  /** Polling du suivi groupé tant que des cours ne sont pas terminaux. */
  React.useEffect(() => {
    if (tracked.length === 0) return;
    const pending = tracked.filter((c) => !TERMINAL_STATUSES.has(c.status));
    if (pending.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const ids = tracked.map((c) => c.id).join(',');
        const res = await fetch(`/api/courses/batch/status?ids=${encodeURIComponent(ids)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.courses)) return;
        const byId = new Map<string, TrackedCourse>(
          data.courses.map((c: TrackedCourse) => [c.id, c]),
        );
        setTracked((current) => current.map((c) => byId.get(c.id) ?? c));
      } catch {
        /* silencieux : on retentera au prochain tick */
      }
    };

    const timer = setInterval(poll, 4000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tracked]);

  const doneCount = tracked.filter((c) => TERMINAL_STATUSES.has(c.status)).length;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          {t('intro.description', { planLabel })}{' '}
          {unlimited ? (
            <span className="font-medium text-foreground">{t('intro.unlimited')}</span>
          ) : (
            <span className="font-medium text-foreground">
              {t('intro.remaining', { count: remaining ?? 0 })}
            </span>
          )}
          .
        </p>
      </header>

      {/* Zone d'import */}
      {tracked.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.title')}</CardTitle>
            <CardDescription>
              {t('import.columnsLabel')} <code className="text-foreground">title</code>{' '}
              {t('import.required')},{' '}
              <code className="text-foreground">level</code>,{' '}
              <code className="text-foreground">language</code>,{' '}
              <code className="text-foreground">platforms</code> {t('import.platformsHint')}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onInputChange}
                className="hidden"
              />
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                <FileUp aria-hidden="true" />
                {t('import.chooseFile')}
              </Button>
              <Button type="button" variant="ghost" onClick={downloadSample}>
                {t('import.downloadTemplate')}
              </Button>
              {fileName && <span className="text-sm text-muted">{fileName}</span>}
            </div>

            {preview && !preview.fatal && (
              <PreviewTable preview={preview} overQuota={overQuota} remaining={remaining} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Lancement */}
      {tracked.length === 0 && preview && !preview.fatal && validCount > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={launch} loading={launching} disabled={overQuota}>
            <Play aria-hidden="true" />
            {t('launch.button', { count: validCount })}
          </Button>
          {overQuota && (
            <span className="text-sm text-danger">{t('launch.overQuota', { remaining: remaining ?? 0 })}</span>
          )}
        </div>
      )}

      {/* Suivi groupé */}
      {tracked.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{t('tracking.title')}</CardTitle>
                <CardDescription>
                  {t('tracking.progress', { done: doneCount, total: tracked.length })}
                </CardDescription>
              </div>
              {doneCount < tracked.length && (
                <RotateCw className="size-4 animate-spin text-muted" aria-hidden="true" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {tracked.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/courses/${c.id}`}
                      className="block truncate text-sm font-medium text-foreground hover:text-primary"
                    >
                      {c.title}
                    </Link>
                    {c.status === 'outline-review' ? (
                      <Link
                        href={`/dashboard/courses/${c.id}`}
                        className="text-2xs font-medium text-accent-300 hover:underline"
                      >
                        {t('tracking.validateOutline')}
                      </Link>
                    ) : (
                      !TERMINAL_STATUSES.has(c.status) && (
                        <span className="text-2xs text-muted">
                          {c.step ? `${c.step} · ` : ''}
                          {c.progress}%
                        </span>
                      )
                    )}
                  </div>
                  <Badge variant={statusBadgeVariant(c.status)}>
                    {STATUS_LABELS[c.status] ? t(STATUS_LABELS[c.status]) : c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {tracked.length === 0 && !preview && (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
        />
      )}
    </div>
  );
}

/** Tableau d'aperçu : lignes valides + rejets détaillés. */
function PreviewTable({
  preview,
  overQuota,
  remaining,
}: {
  preview: ParsedBatch;
  overQuota: boolean;
  remaining: number | null;
}) {
  const { valid, invalid } = preview;
  const t = useTranslations('batch');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-foreground">{t('preview.valid', { count: valid.length })}</span>
        {invalid.length > 0 && (
          <span className="text-danger">· {t('preview.rejected', { count: invalid.length })}</span>
        )}
        {overQuota && remaining !== null && (
          <span className="text-warning">· {t('preview.quotaRemaining', { remaining })}</span>
        )}
      </div>

      {valid.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-start text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">#</th>
                <th className="px-3 py-2 text-start font-semibold">{t('preview.colTitle')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('preview.colLevel')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('preview.colLanguage')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('preview.colPlatforms')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {valid.map((row, i) => {
                const beyond = overQuota && remaining !== null && i >= remaining;
                return (
                  <tr key={row.line} className={cn(beyond && 'opacity-50')}>
                    <td className="px-3 py-2 text-muted">{row.line}</td>
                    <td className="px-3 py-2 text-foreground">{row.input.title}</td>
                    <td className="px-3 py-2 text-muted">{row.input.difficulty}</td>
                    <td className="px-3 py-2 text-muted">{row.input.locale}</td>
                    <td className="px-3 py-2 text-muted">
                      {row.input.targetPlatforms.length > 0
                        ? row.input.targetPlatforms.join(', ')
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invalid.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="mb-2 text-xs font-semibold text-danger">{t('preview.rejectedTitle')}</p>
          <ul className="space-y-1 text-xs text-muted">
            {invalid.slice(0, 20).map((row) => (
              <li key={row.line}>
                <span className="font-medium text-foreground">{t('preview.lineLabel', { line: row.line })}</span>{' '}
                {row.errors.join(' ')}
              </li>
            ))}
            {invalid.length > 20 && <li>{t('preview.moreRows', { count: invalid.length - 20 })}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
