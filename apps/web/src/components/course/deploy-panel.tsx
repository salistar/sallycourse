'use client';

import * as React from 'react';
import {
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Rocket,
  UploadCloud,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  useToast,
  type BadgeProps,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { DownloadReportButton } from './download-report-button';
import { useCourseProgress } from '@/hooks/use-course-progress';
import {
  estimateBatchSeconds,
  formatDuration,
  MAX_CONCURRENT_DEPLOYMENTS,
} from '@/lib/deploy-catalog';
import type { DeploymentMode } from '@sallycourse/db';

/**
 * Orchestrateur multi-déploiement (P44) — sélection de plateformes, estimation
 * de durée, lancement, puis tableau de bord temps réel (une ligne par
 * plateforme : étape, leçon X/Y, logs dépliables, retry). Le direct est câblé
 * sur le flux SSE de progression du cours (même canal que la génération),
 * complété par un snapshot REST des Deployment au montage et après chaque action.
 */

/* ------------------------------------------------------------------ */
/* Types de données                                                     */
/* ------------------------------------------------------------------ */

/** Statut d'un déploiement (aligné DEPLOYMENT_STATUSES). */
type DeployStatus = 'pending' | 'running' | 'paused' | 'failed' | 'published';

interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  kind: string;
  capabilities: { modes: DeploymentMode[]; needsBrowser: boolean };
  connected: boolean;
  accountLabel?: string;
}

interface DeploymentLog {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

interface DeploymentRow {
  id: string;
  platform: string;
  status: DeployStatus;
  mode: string;
  externalUrl: string | null;
  checkpoint: { lessonIndex: number; step: string };
  logs: DeploymentLog[];
  updatedAt: number;
}

/** Leçon impactée par une mise à jour ciblée (P46). */
interface UpdatedLesson {
  lessonId: string;
  index: number;
  title: string;
  kind: 'new' | 'modified';
}

/** Résumé des mises à jour disponibles pour une plateforme déployée. */
interface PlatformUpdates {
  platform: string;
  status: DeployStatus;
  deployedCount: number;
  updates: UpdatedLesson[];
}

export interface DeployPanelProps {
  courseId: string;
  lessonCount: number;
}

/* ------------------------------------------------------------------ */
/* Correspondances d'affichage                                          */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Record<DeployStatus, { variant: NonNullable<BadgeProps['variant']>; label: string }> = {
  pending: { variant: 'draft', label: 'En file' },
  running: { variant: 'generating', label: 'En cours' },
  paused: { variant: 'draft', label: 'En pause' },
  failed: { variant: 'failed', label: 'Échec' },
  published: { variant: 'published', label: 'Publié' },
};

const MODE_LABEL: Record<string, string> = {
  auto: 'Automatique',
  assisted: 'Assisté',
  manual: 'Manuel',
};

/** Étape du checkpoint → libellé lisible. */
const STEP_LABEL: Record<string, string> = {
  '': 'Initialisation',
  authenticate: 'Authentification',
  createCourse: 'Création du cours',
  upload: 'Téléversement des leçons',
  update: 'Mise à jour des leçons',
  landing: 'Page de présentation',
  review: 'Soumission à la revue',
  done: 'Terminé',
};

/** Un déploiement est-il en cours (occupe une place de concurrence) ? */
function isActive(status: DeployStatus): boolean {
  return status === 'pending' || status === 'running';
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */

export function DeployPanel({ courseId, lessonCount }: DeployPanelProps) {
  const { toast } = useToast();
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<DeploymentMode>('auto');
  const [deployments, setDeployments] = React.useState<DeploymentRow[]>([]);
  const [launching, setLaunching] = React.useState(false);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  // Mises à jour ciblées disponibles par plateforme déployée (P46).
  const [platformUpdates, setPlatformUpdates] = React.useState<PlatformUpdates[]>([]);
  const [updating, setUpdating] = React.useState<string | null>(null);

  // Flux de progression temps réel (canal partagé avec la génération).
  const { step: liveStep, progress: liveProgress, logs: liveLogs } = useCourseProgress(courseId);

  /** Recharge le snapshot des déploiements (au montage / après action / en direct). */
  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/deployments`);
      if (!res.ok) return;
      const data = (await res.json()) as { deployments?: DeploymentRow[] };
      if (Array.isArray(data.deployments)) setDeployments(data.deployments);
    } catch {
      // Snapshot best-effort : le direct SSE prend le relais.
    }
  }, [courseId]);

  /** Recharge les mises à jour ciblées disponibles (leçons modifiées, P46). */
  const refreshUpdates = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/deployments/updates`);
      if (!res.ok) return;
      const data = (await res.json()) as { platforms?: PlatformUpdates[] };
      if (Array.isArray(data.platforms)) setPlatformUpdates(data.platforms);
    } catch {
      // Best-effort : la section « à jour » reste masquée en cas d'échec.
    }
  }, [courseId]);

  // Catalogue + snapshot initial.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/platforms/catalog');
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { platforms?: CatalogEntry[] };
          if (Array.isArray(data.platforms)) setCatalog(data.platforms);
        }
      } catch {
        // Catalogue indisponible : l'écran reste vide, réessai au refresh manuel.
      }
    })();
    void refresh();
    void refreshUpdates();
    return () => {
      cancelled = true;
    };
  }, [refresh, refreshUpdates]);

  // Rafraîchissement piloté par le direct : à chaque événement de déploiement,
  // on resynchronise les lignes (statut/checkpoint/URL persistés côté worker).
  const activeCount = deployments.filter((d) => isActive(d.status)).length;
  React.useEffect(() => {
    if (liveStep !== 'deployment') return;
    void refresh();
    void refreshUpdates();
  }, [liveStep, liveProgress, refresh, refreshUpdates]);

  // Poll léger tant qu'au moins un déploiement est actif (filet si SSE muet).
  React.useEffect(() => {
    if (activeCount === 0) return;
    const timer = setInterval(() => void refresh(), 4_000);
    return () => clearInterval(timer);
  }, [activeCount, refresh]);

  // Notification in-app à la fin (transition actif → terminé).
  const prevActiveRef = React.useRef(0);
  React.useEffect(() => {
    if (prevActiveRef.current > 0 && activeCount === 0 && deployments.length > 0) {
      const failed = deployments.filter((d) => d.status === 'failed').length;
      const published = deployments.filter((d) => d.status === 'published').length;
      toast({
        variant: failed > 0 ? 'danger' : 'success',
        title: failed > 0 ? 'Déploiement terminé avec des échecs' : 'Déploiement terminé',
        description:
          `${published} plateforme(s) publiée(s)` +
          (failed > 0 ? `, ${failed} en échec (relançables).` : '.'),
      });
    }
    prevActiveRef.current = activeCount;
  }, [activeCount, deployments, toast]);

  const selectableCount = catalog.length;
  const selectedList = React.useMemo(() => [...selected], [selected]);

  // Estimation de durée du lot sélectionné (concurrence prise en compte).
  const estimateSeconds = React.useMemo(
    () => (selectedList.length ? estimateBatchSeconds(selectedList, lessonCount) : 0),
    [selectedList, lessonCount],
  );

  /** Modes communs à toutes les plateformes sélectionnées (intersection). */
  const availableModes = React.useMemo<DeploymentMode[]>(() => {
    if (!selectedList.length) return ['auto', 'assisted', 'manual'];
    const sets = selectedList
      .map((id) => catalog.find((c) => c.id === id)?.capabilities.modes ?? [])
      .filter((m) => m.length > 0);
    if (!sets.length) return ['auto'];
    return sets.reduce((acc, m) => acc.filter((x) => m.includes(x)), sets[0]!);
  }, [selectedList, catalog]);

  // Rabat le mode sur un mode disponible si l'intersection l'exclut.
  React.useEffect(() => {
    if (availableModes.length && !availableModes.includes(mode)) {
      setMode(availableModes[0]!);
    }
  }, [availableModes, mode]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function launch(): Promise<void> {
    if (!selectedList.length) return;
    setLaunching(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: selectedList, mode }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: 'Lancement impossible', description: data?.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Déploiement lancé',
        description: `${selectedList.length} plateforme(s) en file (max ${MAX_CONCURRENT_DEPLOYMENTS} en parallèle).`,
      });
      setSelected(new Set());
      await refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setLaunching(false);
    }
  }

  async function retry(platform: string): Promise<void> {
    setRetrying(platform);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/deployments/${encodeURIComponent(platform)}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ variant: 'danger', title: 'Relance impossible', description: data?.error });
        return;
      }
      toast({ variant: 'success', title: 'Déploiement relancé', description: platformLabel(platform) });
      await refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setRetrying(null);
    }
  }

  /** Lance la mise à jour ciblée d'une plateforme (re-upload des leçons modifiées). */
  async function update(platform: string): Promise<void> {
    setUpdating(platform);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/deployments/${encodeURIComponent(platform)}/update`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ variant: 'danger', title: 'Mise à jour impossible', description: data?.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Mise à jour lancée',
        description: `${platformLabel(platform)} — leçons modifiées en cours de re-publication.`,
      });
      await Promise.all([refresh(), refreshUpdates()]);
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setUpdating(null);
    }
  }

  const platformLabel = React.useCallback(
    (id: string) => catalog.find((c) => c.id === id)?.label ?? id,
    [catalog],
  );

  // Plateformes ayant au moins une leçon à re-publier.
  const pendingUpdates = React.useMemo(
    () => platformUpdates.filter((p) => p.updates.length > 0),
    [platformUpdates],
  );

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Publication</p>
            <CardTitle className="mt-0.5 flex items-center gap-2 text-lg">
              <Rocket className="size-5 text-accent" aria-hidden="true" />
              Déployer le cours
            </CardTitle>
          </div>
          {deployments.length > 0 && (
            <Badge variant={activeCount > 0 ? 'generating' : 'ready'}>
              {activeCount > 0
                ? `${activeCount} en cours`
                : `${deployments.length} déploiement${deployments.length > 1 ? 's' : ''}`}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted">
          Sélectionnez les plateformes cibles, choisissez le mode, puis lancez. Le worker
          traite au plus {MAX_CONCURRENT_DEPLOYMENTS} déploiements en parallèle ; les autres
          patientent en file.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ── Sélection des plateformes ─────────────────────────── */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {catalog.length === 0 ? (
            <p className="text-sm text-muted">Chargement des plateformes…</p>
          ) : (
            catalog.map((entry) => {
              const active = selected.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => toggle(entry.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-start gap-3 rounded-md border p-3 text-start transition-colors duration-fast',
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-surface hover:border-ring/50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                      active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                    aria-hidden="true"
                  >
                    {active && <span className="text-xs font-bold">✓</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{entry.label}</span>
                      {entry.connected ? (
                        <Badge variant="published" hideDot className="text-2xs">
                          Connecté
                        </Badge>
                      ) : (
                        <Badge variant="draft" hideDot className="text-2xs">
                          Mode simulé
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        {entry.capabilities.needsBrowser ? (
                          <Monitor className="size-3" aria-hidden="true" />
                        ) : (
                          <Zap className="size-3" aria-hidden="true" />
                        )}
                        {entry.capabilities.needsBrowser ? 'Navigateur' : 'API directe'}
                      </span>
                      <span>{entry.capabilities.modes.map((m) => MODE_LABEL[m] ?? m).join(' · ')}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* ── Barre de lancement ────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-border bg-surface-subtle p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Select
              label="Mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as DeploymentMode)}
              wrapperClassName="w-44"
              disabled={selectableCount === 0}
            >
              {availableModes.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m] ?? m}
                </option>
              ))}
            </Select>
            <div className="text-sm">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Estimation</p>
              <p className="mt-1 font-medium text-foreground">
                {selectedList.length === 0
                  ? 'Aucune plateforme'
                  : `${selectedList.length} plateforme${selectedList.length > 1 ? 's' : ''} · ${formatDuration(estimateSeconds)}`}
              </p>
            </div>
          </div>
          <Button
            variant="gold"
            loading={launching}
            disabled={selectedList.length === 0}
            onClick={() => void launch()}
          >
            {!launching && <Rocket aria-hidden="true" />}
            Lancer le déploiement
          </Button>
        </div>

        {/* ── Mises à jour ciblées (P46) ────────────────────────── */}
        {pendingUpdates.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <UploadCloud className="size-4 text-accent" aria-hidden="true" />
                Mettre à jour les plateformes
              </p>
              <Badge variant="draft" hideDot className="text-2xs">
                {pendingUpdates.reduce((n, p) => n + p.updates.length, 0)} leçon(s) modifiée(s)
              </Badge>
            </div>
            <p className="text-xs text-muted">
              Des leçons ont été régénérées depuis le dernier déploiement. Republier ne re-uploade
              que les leçons impactées.
            </p>
            <div className="mt-1 flex flex-col gap-2">
              {pendingUpdates.map((p) => (
                <div
                  key={p.platform}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{platformLabel(p.platform)}</span>
                      <Badge variant="draft" hideDot className="text-2xs">
                        {p.updates.length} à mettre à jour
                      </Badge>
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5 text-2xs text-muted">
                      {p.updates.slice(0, 5).map((u) => (
                        <li key={u.lessonId} className="truncate">
                          <span className="tabular-nums">#{u.index + 1}</span> {u.title}{' '}
                          <span className="text-accent">
                            {u.kind === 'new' ? '(nouvelle)' : '(modifiée)'}
                          </span>
                        </li>
                      ))}
                      {p.updates.length > 5 && (
                        <li className="text-muted">+ {p.updates.length - 5} autre(s)…</li>
                      )}
                    </ul>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={updating === p.platform}
                    onClick={() => void update(p.platform)}
                  >
                    {updating !== p.platform && <UploadCloud aria-hidden="true" />}
                    Mettre à jour
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tableau de bord des déploiements ──────────────────── */}
        {deployments.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                Déploiements
              </p>
              {/* Rapport PDF de synthèse (P50) — toutes plateformes agrégées. */}
              <DownloadReportButton courseId={courseId} />
            </div>
            <div className="flex flex-col gap-2">
              {deployments.map((row) => (
                <DeploymentRowView
                  key={row.id}
                  row={row}
                  label={platformLabel(row.platform)}
                  lessonCount={lessonCount}
                  liveProgress={liveStep === 'deployment' && isActive(row.status) ? liveProgress : undefined}
                  liveLog={
                    liveStep === 'deployment' && isActive(row.status)
                      ? liveLogs[liveLogs.length - 1]?.msg
                      : undefined
                  }
                  retrying={retrying === row.platform}
                  onRetry={() => void retry(row.platform)}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Ligne de déploiement (une plateforme)                                */
/* ------------------------------------------------------------------ */

interface DeploymentRowViewProps {
  row: DeploymentRow;
  label: string;
  lessonCount: number;
  liveProgress?: number;
  liveLog?: string;
  retrying: boolean;
  onRetry: () => void;
}

function DeploymentRowView({
  row,
  label,
  lessonCount,
  liveProgress,
  liveLog,
  retrying,
  onRetry,
}: DeploymentRowViewProps) {
  const [open, setOpen] = React.useState(false);
  const badge = STATUS_BADGE[row.status];
  const running = row.status === 'running';
  const stepLabel = STEP_LABEL[row.checkpoint.step] ?? row.checkpoint.step ?? '—';
  const uploaded = Math.min(row.checkpoint.lessonIndex, lessonCount);

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {running && <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden="true" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{label}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <span className="text-2xs text-muted">{MODE_LABEL[row.mode] ?? row.mode}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">
              {stepLabel}
              {lessonCount > 0 && (
                <>
                  {' · '}
                  <span className="tabular-nums">
                    Leçon {uploaded}/{lessonCount}
                  </span>
                </>
              )}
              {liveLog && <> · {liveLog}</>}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {row.externalUrl && (
            <a
              href={row.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Voir
            </a>
          )}
          {row.status === 'failed' && (
            <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
              {!retrying && <RefreshCw aria-hidden="true" />}
              Relancer
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Masquer les logs' : 'Afficher les logs'}
            className="inline-flex size-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-4 transition-transform duration-fast', open && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Barre de progression live (étape courante). */}
      {liveProgress !== undefined && (
        <div className="px-3 pb-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-info transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, liveProgress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Logs dépliables. */}
      {open && (
        <div className="border-t border-border p-3">
          {row.logs.length === 0 ? (
            <p className="text-xs text-muted">Aucun log pour le moment.</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto font-mono text-2xs leading-relaxed">
              {row.logs.map((log, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex gap-2',
                    log.level === 'error'
                      ? 'text-danger'
                      : log.level === 'warn'
                        ? 'text-accent'
                        : 'text-foreground/80',
                  )}
                >
                  <span className="shrink-0 tabular-nums text-muted">
                    {new Date(log.ts).toLocaleTimeString('fr-FR')}
                  </span>
                  <span className="min-w-0 break-words">{log.msg}</span>
                </li>
              ))}
            </ul>
          )}
          {row.externalUrl && (
            <a
              href={row.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Globe className="size-3.5" aria-hidden="true" />
              {row.externalUrl}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
