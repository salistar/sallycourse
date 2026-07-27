'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Rocket,
  Sparkles,
  Table2,
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
  Input,
  Select,
  useToast,
  type BadgeProps,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import { DownloadReportButton } from './download-report-button';
import { DownloadGuideButton } from './download-guide-button';
import { SavePresetButton } from './save-preset-button';
import { DripSchedulePanel } from './drip-schedule-panel';
import { useCourseProgress } from '@/hooks/use-course-progress';
import {
  estimateBatchSeconds,
  formatDuration,
  MAX_CONCURRENT_DEPLOYMENTS,
  type DeployRisk,
} from '@/lib/deploy-catalog';
import type { DeploymentMode } from '@sallycourse/db';
// Sous-module PUR (P178) : jamais le barrel côté client (node:crypto casserait
// le bundle). Sert à jauger localement si la publication manuelle est possible.
import {
  canPublishManually,
  initManualChecklist,
  type DeployChecklistItem,
} from '@sallycourse/shared/deploy-checklist';

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
  /** Risque CGU dérivé par mode (P175) — badge d'avertissement, jamais bloquant. */
  risks: Partial<Record<DeploymentMode, DeployRisk>>;
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
  /** Checklist de publication manuelle (P178) — vide hors mode manuel. */
  checklist: DeployChecklistItem[];
  /** Horodatage (ms) de la bascule en publié par publication manuelle (P178). */
  publishedManuallyAt: number | null;
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

/** Une plateforme recommandée par la stratégie cross-platform (P110). */
interface RecommendedPlatform {
  platform: string;
  mode: DeploymentMode;
  rationale: string;
  timing: number;
  utm?: Record<string, string>;
}

/** Une entrée du calendrier de publication échelonné (P110). */
interface CalendarEntry {
  platform: string;
  action: string;
  dayOffset: number;
}

/** Réponse de POST /api/courses/[id]/deploy-strategy. */
interface DeployStrategyResponse {
  source: 'claude' | 'local';
  recommendedPlatforms: RecommendedPlatform[];
  calendarPlan: CalendarEntry[];
}

export interface DeployPanelProps {
  courseId: string;
  lessonCount: number;
  /** Score de qualité pédagogique courant (P94), null si jamais évalué. */
  qualityScore?: number | null;
}

/** Seuil d'affichage aligné sur QUALITY_SCORE.MIN_DEPLOY_THRESHOLD (packages/shared). */
const QUALITY_THRESHOLD = 60;

/* ------------------------------------------------------------------ */
/* Correspondances d'affichage                                          */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Record<DeployStatus, { variant: NonNullable<BadgeProps['variant']>; labelKey: string }> = {
  pending: { variant: 'draft', labelKey: 'statusPending' },
  running: { variant: 'generating', labelKey: 'statusRunning' },
  paused: { variant: 'draft', labelKey: 'statusPaused' },
  failed: { variant: 'failed', labelKey: 'statusFailed' },
  published: { variant: 'published', labelKey: 'statusPublished' },
};

const MODE_LABEL: Record<string, string> = {
  auto: 'modeAuto',
  assisted: 'modeAssisted',
  manual: 'modeManual',
};

/** Ordre canonique des modes (colonnes de la matrice des capacités). */
const ALL_MODES: DeploymentMode[] = ['auto', 'assisted', 'manual'];

/**
 * Plateformes de clips courts (P106/P181) proposables au drip mais absentes du
 * catalogue de déploiement classique (elles ne publient pas un cours entier mais
 * des ShortClip). Ajoutées à la liste du planificateur programmé.
 */
const CLIP_DRIP_PLATFORMS: { id: string; label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];

/** Préfixe de clé localStorage pour mémoriser le mode choisi par plateforme (P175). */
const MODE_STORAGE_PREFIX = 'sallycourse:deploy-mode:';

/** Modes supportés par une plateforme (repli prudent sur `auto`). */
function modesOf(entry: CatalogEntry | undefined): DeploymentMode[] {
  return entry && entry.capabilities.modes.length > 0 ? entry.capabilities.modes : ['auto'];
}

/** Lit le mode mémorisé pour une plateforme (best-effort, jamais throw). */
function readStoredMode(platform: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MODE_STORAGE_PREFIX + platform);
  } catch {
    return null;
  }
}

/** Mémorise le mode choisi pour une plateforme (best-effort). */
function storeMode(platform: string, mode: DeploymentMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MODE_STORAGE_PREFIX + platform, mode);
  } catch {
    // Stockage indisponible (mode privé, quota) : mémorisation ignorée.
  }
}

/** Étape du checkpoint → libellé lisible. */
const STEP_LABEL: Record<string, string> = {
  '': 'stepInit',
  authenticate: 'stepAuthenticate',
  createCourse: 'stepCreateCourse',
  upload: 'stepUpload',
  update: 'stepUpdate',
  landing: 'stepLanding',
  review: 'stepReview',
  done: 'stepDone',
};

/** Un déploiement est-il en cours (occupe une place de concurrence) ? */
function isActive(status: DeployStatus): boolean {
  return status === 'pending' || status === 'running';
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */

export function DeployPanel({ courseId, lessonCount, qualityScore = null }: DeployPanelProps) {
  const { toast } = useToast();
  const t = useTranslations('course.deploy');
  const tApiError = useTranslations('apiErrors');
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Mode PAR plateforme (P175) : un choix indépendant par plateforme, contraint
  // aux capacités de CHACUNE, mémorisé en localStorage. Remplace le mode global.
  const [modesByPlatform, setModesByPlatform] = React.useState<Record<string, DeploymentMode>>({});
  const [deployments, setDeployments] = React.useState<DeploymentRow[]>([]);
  const [launching, setLaunching] = React.useState(false);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  // Bascule de mode d'un déploiement bloqué (P179) — clé `${platform}:${mode}`.
  const [switching, setSwitching] = React.useState<string | null>(null);
  // Mises à jour ciblées disponibles par plateforme déployée (P46).
  const [platformUpdates, setPlatformUpdates] = React.useState<PlatformUpdates[]>([]);
  const [updating, setUpdating] = React.useState<string | null>(null);
  // Mention « contenu généré par IA » (P66) — obligatoire pour publier sur
  // Udemy. Pré-cochée par défaut : tout cours SallyCourse EST généré par IA,
  // la transparence est donc toujours due — l'auteur peut décocher (et bloquer
  // Udemy) mais n'a pas à re-cocher à chaque déploiement.
  const [aiDisclosureAccepted, setAiDisclosureAccepted] = React.useState(true);
  const [savingDisclosure, setSavingDisclosure] = React.useState(false);
  // Confirmation explicite (P94) — score de qualité sous le seuil, contournement volontaire.
  const [confirmLowQuality, setConfirmLowQuality] = React.useState(false);
  // Stratégie cross-platform suggérée (P110) — plateformes + calendrier de publication.
  const [strategy, setStrategy] = React.useState<DeployStrategyResponse | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);

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
    void (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/ai-disclosure`);
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { accepted?: boolean };
          setAiDisclosureAccepted(Boolean(data.accepted));
        }
      } catch {
        // Best-effort : la case reste décochée par défaut.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, refresh, refreshUpdates]);

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
        title: failed > 0 ? t('toastDeployDoneWithFailuresTitle') : t('toastDeployDoneTitle'),
        description:
          t('toastDeployDoneCount', { count: published }) +
          (failed > 0 ? t('toastDeployDoneFailedSuffix', { count: failed }) : '.'),
      });
    }
    prevActiveRef.current = activeCount;
  }, [activeCount, deployments, toast]);

  const selectedList = React.useMemo(() => [...selected], [selected]);

  // Plateformes proposables au planificateur drip (P181) : catalogue de
  // déploiement + plateformes de clips courts (TikTok/Instagram).
  const dripPlatforms = React.useMemo(
    () => [...catalog.map((c) => ({ id: c.id, label: c.label })), ...CLIP_DRIP_PLATFORMS],
    [catalog],
  );

  // Estimation de durée du lot sélectionné (concurrence prise en compte).
  const estimateSeconds = React.useMemo(
    () => (selectedList.length ? estimateBatchSeconds(selectedList, lessonCount) : 0),
    [selectedList, lessonCount],
  );

  // Pré-remplit le mode de chaque plateforme au chargement du catalogue :
  // valeur mémorisée (localStorage) si encore supportée, sinon 1er mode supporté.
  // Ne touche pas les plateformes déjà choisies dans la session (choix utilisateur).
  React.useEffect(() => {
    if (catalog.length === 0) return;
    setModesByPlatform((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of catalog) {
        if (next[entry.id]) continue;
        const modes = modesOf(entry);
        const stored = readStoredMode(entry.id);
        next[entry.id] = stored && modes.includes(stored as DeploymentMode)
          ? (stored as DeploymentMode)
          : modes[0]!;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [catalog]);

  /** Mode effectif d'une plateforme (repli sur le 1er mode supporté). */
  const modeFor = React.useCallback(
    (id: string): DeploymentMode =>
      modesByPlatform[id] ?? modesOf(catalog.find((c) => c.id === id))[0]!,
    [modesByPlatform, catalog],
  );

  /** Change + mémorise le mode d'une plateforme. */
  const setModeFor = React.useCallback((id: string, next: DeploymentMode): void => {
    setModesByPlatform((prev) => ({ ...prev, [id]: next }));
    storeMode(id, next);
  }, []);

  // Plateformes sélectionnées dont le mode courant porte un risque CGU (P175).
  const riskySelected = React.useMemo(
    () =>
      selectedList.filter((id) => {
        const entry = catalog.find((c) => c.id === id);
        return entry ? Boolean(entry.risks[modeFor(id)]) : false;
      }),
    [selectedList, catalog, modeFor],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Udemy exige la transparence sur le contenu généré par IA (P66) : tant que
  // la case n'est pas cochée, le lancement est bloqué côté UI (et re-vérifié
  // côté API — ne jamais faire confiance au client seul).
  const udemySelected = selected.has('udemy');
  const needsAiDisclosure = udemySelected && !aiDisclosureAccepted;

  // Score de qualité pédagogique (P94) sous le seuil : lancement bloqué tant
  // que l'utilisateur n'a pas coché la confirmation explicite (jamais de
  // blocage silencieux — le message et la case sont visibles ci-dessous).
  const qualityBelowThreshold = qualityScore !== null && qualityScore < QUALITY_THRESHOLD;
  const needsQualityConfirmation = qualityBelowThreshold && !confirmLowQuality;

  /** Enregistre l'acceptation de la mention IA générée sur le cours. */
  async function toggleAiDisclosure(next: boolean): Promise<void> {
    setSavingDisclosure(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/ai-disclosure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: next }),
      });
      if (res.ok) {
        const data = (await res.json()) as { accepted?: boolean };
        setAiDisclosureAccepted(Boolean(data.accepted));
      }
    } catch {
      // Best-effort : la case revient à son état précédent au prochain chargement.
    } finally {
      setSavingDisclosure(false);
    }
  }

  async function launch(): Promise<void> {
    if (!selectedList.length) return;
    if (needsAiDisclosure) return;
    if (needsQualityConfirmation) return;
    setLaunching(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platforms: selectedList,
          // Mode PAR plateforme (P175) + `mode` global conservé pour rétro-compat.
          modes: Object.fromEntries(selectedList.map((id) => [id, modeFor(id)])),
          mode: modeFor(selectedList[0]!),
          confirmLowQuality,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('toastLaunchFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({
        variant: 'success',
        title: t('toastLaunchedTitle'),
        description: t('toastLaunchedDesc', { count: selectedList.length, max: MAX_CONCURRENT_DEPLOYMENTS }),
      });
      setSelected(new Set());
      await refresh();
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
    } finally {
      setLaunching(false);
    }
  }

  /**
   * Demande une recommandation de stratégie cross-platform (P110) et
   * pré-remplit la sélection : seules les plateformes recommandées PRÉSENTES
   * dans le catalogue de déploiement (case à cocher) sont cochées ; les
   * canaux hors catalogue (réseaux sociaux type LinkedIn/TikTok) restent
   * affichés à titre informatif dans le calendrier, sans case correspondante.
   */
  async function suggestStrategy(): Promise<void> {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/deploy-strategy`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | (DeployStrategyResponse & { error?: string })
        | null;
      if (!res.ok || !data) {
        toast({ variant: 'danger', title: t('toastSuggestUnavailableTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      setStrategy(data);
      const catalogIds = new Set(catalog.map((c) => c.id));
      const recommendedInCatalog = data.recommendedPlatforms.filter((p) => catalogIds.has(p.platform));
      setSelected(new Set(recommendedInCatalog.map((p) => p.platform)));
      // Applique le mode recommandé PAR plateforme (P175), s'il est supporté.
      for (const p of recommendedInCatalog) {
        const modes = modesOf(catalog.find((c) => c.id === p.platform));
        if (modes.includes(p.mode)) setModeFor(p.platform, p.mode);
      }
      toast({
        variant: 'success',
        title: t('toastStrategySuggestedTitle'),
        description: t('toastStrategySuggestedDesc', { count: data.recommendedPlatforms.length }),
      });
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
    } finally {
      setSuggesting(false);
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
        toast({ variant: 'danger', title: t('toastRetryFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('toastRetriedTitle'), description: platformLabel(platform) });
      await refresh();
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
    } finally {
      setRetrying(null);
    }
  }

  /**
   * Bascule un déploiement bloqué (paused/failed) vers un autre mode (P179), en
   * REPRENANT depuis le checkpoint : `assisted` ré-enfile le job deploy, `manual`
   * bascule le suivi manuel + prépare le pack des étapes restantes.
   */
  async function switchMode(platform: string, mode: 'assisted' | 'manual'): Promise<void> {
    setSwitching(`${platform}:${mode}`);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/deployments/${encodeURIComponent(platform)}/switch-mode`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        },
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('toastSwitchFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({
        variant: 'success',
        title: mode === 'assisted' ? t('toastSwitchAssistedTitle') : t('toastSwitchManualTitle'),
        description:
          mode === 'assisted'
            ? t('toastSwitchAssistedDesc', { platform: platformLabel(platform) })
            : t('toastSwitchManualDesc', { platform: platformLabel(platform) }),
      });
      await refresh();
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
    } finally {
      setSwitching(null);
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
        toast({ variant: 'danger', title: t('toastUpdateFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({
        variant: 'success',
        title: t('toastUpdateStartedTitle'),
        description: t('toastUpdateStartedDesc', { platform: platformLabel(platform) }),
      });
      await Promise.all([refresh(), refreshUpdates()]);
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
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
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('sectionLabel')}</p>
            <CardTitle className="mt-0.5 flex items-center gap-2 text-lg">
              <Rocket className="size-5 text-accent" aria-hidden="true" />
              {t('title')}
            </CardTitle>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={suggesting}
              disabled={catalog.length === 0}
              onClick={() => void suggestStrategy()}
            >
              {!suggesting && <Sparkles aria-hidden="true" />}
              {t('suggestStrategyButton')}
            </Button>
            {deployments.length > 0 && (
              <Badge variant={activeCount > 0 ? 'generating' : 'ready'}>
                {activeCount > 0
                  ? t('badgeActiveCount', { count: activeCount })
                  : t('badgeDeploymentCount', { count: deployments.length })}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-sm text-muted">
          {t('intro', { max: MAX_CONCURRENT_DEPLOYMENTS })}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ── Sélection des plateformes ─────────────────────────── */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {catalog.length === 0 ? (
            <p className="text-sm text-muted">{t('loadingPlatforms')}</p>
          ) : (
            catalog.map((entry) => {
              const active = selected.has(entry.id);
              const modes = modesOf(entry);
              const currentMode = modeFor(entry.id);
              const risk = entry.risks[currentMode];
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex flex-col rounded-md border transition-colors duration-fast',
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-surface',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(entry.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-start gap-3 rounded-md p-3 text-start transition-colors duration-fast',
                      !active && 'hover:bg-surface-subtle',
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
                            {t('connected')}
                          </Badge>
                        ) : (
                          <Badge variant="draft" hideDot className="text-2xs">
                            {t('simulatedMode')}
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
                          {entry.capabilities.needsBrowser ? t('browser') : t('apiDirect')}
                        </span>
                        <span>{modes.map((m) => (MODE_LABEL[m] ? t(MODE_LABEL[m]) : m)).join(' · ')}</span>
                      </span>
                    </span>
                  </button>

                  {/* Mode PAR plateforme (P175) : visible une fois la plateforme cochée,
                      contraint aux capacités de CETTE plateforme, avec badge de risque CGU. */}
                  {active && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
                      <Select
                        aria-label={t('modeSelectAria', { platform: entry.label })}
                        value={currentMode}
                        onChange={(e) => setModeFor(entry.id, e.target.value as DeploymentMode)}
                        wrapperClassName="w-40"
                      >
                        {modes.map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m] ? t(MODE_LABEL[m]) : m}
                          </option>
                        ))}
                      </Select>
                      {risk && (
                        <Badge variant="draft" hideDot className="gap-1 text-2xs" title={risk.detail}>
                          <AlertTriangle className="size-3 text-accent" aria-hidden="true" />
                          {risk.label}
                        </Badge>
                      )}
                      {/* Guide d'upload manuel (P176) : en mode manuel, un pack
                          téléchargeable (guide HTML/PDF + contenu + blocs copier). */}
                      {currentMode === 'manual' && (
                        <div className="basis-full pt-0.5">
                          <DownloadGuideButton
                            courseId={courseId}
                            platform={entry.id}
                            platformLabel={entry.label}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Matrice des capacités (P175) ──────────────────────── */}
        <CapabilityMatrix catalog={catalog} />

        {/* ── Publication programmée « drip » (P181) ────────────── */}
        <DripSchedulePanel courseId={courseId} platforms={dripPlatforms} />

        {/* ── Stratégie cross-platform suggérée (P110) ──────────────── */}
        {strategy && (
          <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                {t('strategyPanelTitle')}
              </p>
              <Badge variant="draft" hideDot className="text-2xs">
                {strategy.source === 'claude' ? t('strategySourceAi') : t('strategySourceLocal')}
              </Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {strategy.recommendedPlatforms.map((p) => (
                <li key={p.platform} className="rounded-md border border-border bg-surface p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{platformLabel(p.platform)}</span>
                    <Badge variant="draft" hideDot className="text-2xs">
                      {MODE_LABEL[p.mode] ?? p.mode}
                    </Badge>
                    <span className="text-2xs text-muted">
                      {p.timing === 0 ? t('dayZero') : t('dayOffset', { days: p.timing })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{p.rationale}</p>
                </li>
              ))}
            </ul>
            {strategy.calendarPlan.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  {t('calendarTitle')}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {strategy.calendarPlan
                    .slice()
                    .sort((a, b) => a.dayOffset - b.dayOffset)
                    .map((entry, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted">
                        <span className="shrink-0 tabular-nums font-medium text-foreground">
                          {entry.dayOffset === 0 ? t('calendarDayZero') : t('dayOffset', { days: entry.dayOffset })}
                        </span>
                        <span>
                          <span className="font-medium text-foreground">{platformLabel(entry.platform)}</span>
                          {' — '}
                          {entry.action}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Mention IA générée (P66) — obligatoire pour Udemy ─────── */}
        {udemySelected && (
          <label
            className={cn(
              'flex items-start gap-3 rounded-md border p-3 text-sm',
              needsAiDisclosure
                ? 'border-accent/50 bg-accent/5'
                : 'border-border bg-surface-subtle',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={aiDisclosureAccepted}
              disabled={savingDisclosure}
              onChange={(e) => void toggleAiDisclosure(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">
                {t('aiDisclosureConfirm')}
              </span>{' '}
              <span className="text-muted">
                {t('aiDisclosureHint')}
              </span>
            </span>
          </label>
        )}

        {/* ── Score de qualité sous le seuil (P94) — confirmation explicite ─ */}
        {qualityBelowThreshold && (
          <label
            className={cn(
              'flex items-start gap-3 rounded-md border p-3 text-sm',
              needsQualityConfirmation ? 'border-danger/50 bg-danger/5' : 'border-border bg-surface-subtle',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={confirmLowQuality}
              onChange={(e) => setConfirmLowQuality(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">
                {t('qualityConfirm', { score: qualityScore, threshold: QUALITY_THRESHOLD })}
              </span>{' '}
              <span className="text-muted">
                {t('qualityConfirmHint')}
              </span>
            </span>
          </label>
        )}

        {/* ── Barre de lancement ────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-border bg-surface-subtle p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="text-sm">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('estimationLabel')}</p>
              <p className="mt-1 font-medium text-foreground">
                {selectedList.length === 0
                  ? t('estimationNone')
                  : t('estimationSummary', { count: selectedList.length, duration: formatDuration(estimateSeconds) })}
              </p>
              <p className="mt-0.5 text-2xs text-muted">
                {t('modeHint')}
              </p>
              {riskySelected.length > 0 && (
                <p className="mt-1 flex items-start gap-1 text-2xs text-accent">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  {t('riskyWarning', { count: riskySelected.length })}
                </p>
              )}
              {needsAiDisclosure && (
                <p className="mt-1 text-2xs text-accent">
                  {t('needsAiDisclosureHint')}
                </p>
              )}
              {needsQualityConfirmation && (
                <p className="mt-1 text-2xs text-danger">
                  {t('needsQualityHint')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Enregistrer la sélection en preset (P109) — composant livré mais
                jamais rendu (audit connectivité 2026-07-17). */}
            <SavePresetButton platforms={selectedList} mode="auto" disabled={selectedList.length === 0} />
            <Button
              variant="gold"
              loading={launching}
              disabled={selectedList.length === 0 || needsAiDisclosure || needsQualityConfirmation}
              onClick={() => void launch()}
            >
              {!launching && <Rocket aria-hidden="true" />}
              {t('launchButton')}
            </Button>
          </div>
        </div>

        {/* ── Mises à jour ciblées (P46) ────────────────────────── */}
        {pendingUpdates.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <UploadCloud className="size-4 text-accent" aria-hidden="true" />
                {t('updatePlatformsTitle')}
              </p>
              <Badge variant="draft" hideDot className="text-2xs">
                {t('modifiedLessonsBadge', { count: pendingUpdates.reduce((n, p) => n + p.updates.length, 0) })}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              {t('updateIntro')}
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
                        {t('toUpdateBadge', { count: p.updates.length })}
                      </Badge>
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5 text-2xs text-muted">
                      {p.updates.slice(0, 5).map((u) => (
                        <li key={u.lessonId} className="truncate">
                          <span className="tabular-nums">#{u.index + 1}</span> {u.title}{' '}
                          <span className="text-accent">
                            {u.kind === 'new' ? t('lessonNew') : t('lessonModified')}
                          </span>
                        </li>
                      ))}
                      {p.updates.length > 5 && (
                        <li className="text-muted">{t('moreLessons', { count: p.updates.length - 5 })}</li>
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
                    {t('updateButton')}
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
                {t('deploymentsLabel')}
              </p>
              {/* Rapport PDF de synthèse (P50) — toutes plateformes agrégées. */}
              <DownloadReportButton courseId={courseId} />
            </div>
            <div className="flex flex-col gap-2">
              {deployments.map((row) => {
                const rowModes = modesOf(catalog.find((c) => c.id === row.platform));
                return (
                  <DeploymentRowView
                    key={row.id}
                    courseId={courseId}
                    row={row}
                    label={platformLabel(row.platform)}
                    lessonCount={lessonCount}
                    platformModes={rowModes}
                    switching={switching}
                    onSwitchMode={(mode) => void switchMode(row.platform, mode)}
                    liveProgress={liveStep === 'deployment' && isActive(row.status) ? liveProgress : undefined}
                    liveLog={
                      liveStep === 'deployment' && isActive(row.status)
                        ? liveLogs[liveLogs.length - 1]?.msg
                        : undefined
                    }
                    retrying={retrying === row.platform}
                    onRetry={() => void retry(row.platform)}
                    onChanged={() => void refresh()}
                  />
                );
              })}
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
  courseId: string;
  row: DeploymentRow;
  label: string;
  lessonCount: number;
  /** Modes supportés par la plateforme (capacités catalogue) — cibles de bascule P179. */
  platformModes: DeploymentMode[];
  /** Clé `${platform}:${mode}` en cours de bascule, ou null. */
  switching: string | null;
  /** Déclenche la bascule vers un autre mode (P179). */
  onSwitchMode: (mode: 'assisted' | 'manual') => void;
  liveProgress?: number;
  liveLog?: string;
  retrying: boolean;
  onRetry: () => void;
  onChanged: () => void;
}

function DeploymentRowView({
  courseId,
  row,
  label,
  lessonCount,
  platformModes,
  switching,
  onSwitchMode,
  liveProgress,
  liveLog,
  retrying,
  onRetry,
  onChanged,
}: DeploymentRowViewProps) {
  const t = useTranslations('course.deploy');
  const format = useFormatter();
  const [open, setOpen] = React.useState(false);
  const badge = STATUS_BADGE[row.status];
  const running = row.status === 'running';
  const stepLabel = STEP_LABEL[row.checkpoint.step] ? t(STEP_LABEL[row.checkpoint.step]) : (row.checkpoint.step || '—');
  const uploaded = Math.min(row.checkpoint.lessonIndex, lessonCount);
  // Suivi manuel (P178) : un déploiement manuel non encore publié montre la
  // checklist + l'input URL + le bouton « Marquer comme publié ».
  const showManualPanel = row.mode === 'manual' && row.status !== 'published';
  // Bascule de mode (P179) : proposée uniquement sur un déploiement bloqué, vers
  // un mode différent réellement supporté par la plateforme.
  const isStuck = row.status === 'paused' || row.status === 'failed';
  const canSwitchAssisted = isStuck && row.mode !== 'assisted' && platformModes.includes('assisted');
  const canSwitchManual = isStuck && row.mode !== 'manual' && platformModes.includes('manual');
  const showSwitchControls = canSwitchAssisted || canSwitchManual;
  // Reprise partielle (P179) : le pack des étapes restantes est pertinent dès
  // qu'un déploiement manual-capable est bloqué APRÈS un début de progression.
  const hasProgress = row.checkpoint.lessonIndex > 0 || Boolean(row.checkpoint.step);
  const showResumePack =
    isStuck && platformModes.includes('manual') && hasProgress;

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {running && <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden="true" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{label}</span>
              <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
              <span className="text-2xs text-muted">{MODE_LABEL[row.mode] ? t(MODE_LABEL[row.mode]) : row.mode}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">
              {stepLabel}
              {lessonCount > 0 && (
                <>
                  {' · '}
                  <span className="tabular-nums">
                    {t('lessonProgress', { current: uploaded, total: lessonCount })}
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
              {t('viewLink')}
            </a>
          )}
          {row.status === 'failed' && (
            <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
              {!retrying && <RefreshCw aria-hidden="true" />}
              {t('retryButton')}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? t('hideLogs') : t('showLogs')}
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

      {/* Bascule et reprise entre modes (P179) — déploiement bloqué. */}
      {(showSwitchControls || showResumePack) && (
        <div className="flex flex-col gap-2.5 border-t border-border bg-surface-subtle p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <RefreshCw className="size-3.5 text-accent" aria-hidden="true" />
            {t('resumeTitle')}
          </p>
          <p className="text-2xs text-muted">
            {t('resumeStoppedAt', { step: stepLabel })}
            {lessonCount > 0 && <>{t('resumeLessonSuffix', { current: uploaded, total: lessonCount })}</>}{t('resumeInstructions')}
          </p>
          {showSwitchControls && (
            <div className="flex flex-wrap items-center gap-2">
              {canSwitchAssisted && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={switching === `${row.platform}:assisted`}
                  disabled={switching !== null}
                  onClick={() => onSwitchMode('assisted')}
                >
                  {switching !== `${row.platform}:assisted` && <Monitor aria-hidden="true" />}
                  {t('switchAssistedButton')}
                </Button>
              )}
              {canSwitchManual && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={switching === `${row.platform}:manual`}
                  disabled={switching !== null}
                  onClick={() => onSwitchMode('manual')}
                >
                  {switching !== `${row.platform}:manual` && <UploadCloud aria-hidden="true" />}
                  {t('switchManualButton', { step: stepLabel })}
                </Button>
              )}
            </div>
          )}
          {showResumePack && (
            <div>
              <DownloadGuideButton
                courseId={courseId}
                platform={row.platform}
                platformLabel={label}
                resume
              />
            </div>
          )}
        </div>
      )}

      {/* Suivi de publication manuelle (P178). */}
      {showManualPanel && (
        <ManualPublishPanel
          courseId={courseId}
          platform={row.platform}
          label={label}
          initialChecklist={row.checklist}
          initialUrl={row.externalUrl}
          onChanged={onChanged}
        />
      )}

      {/* Logs dépliables. */}
      {open && (
        <div className="border-t border-border p-3">
          {row.logs.length === 0 ? (
            <p className="text-xs text-muted">{t('noLogs')}</p>
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
                    {format.dateTime(new Date(log.ts), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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

/* ------------------------------------------------------------------ */
/* Panneau de publication manuelle (P178)                               */
/* ------------------------------------------------------------------ */

interface ManualPublishPanelProps {
  courseId: string;
  platform: string;
  label: string;
  initialChecklist: DeployChecklistItem[];
  initialUrl: string | null;
  onChanged: () => void;
}

/**
 * En mode manuel (P178), l'auteur publie lui-même le cours puis rend compte ici :
 * il coche chaque étape franchie et colle l'URL publique finale. Les changements
 * sont persistés à la volée (route .../status) ; dès que TOUT est coché et l'URL
 * http(s) valide, le déploiement bascule en publié côté serveur (qui reste la
 * source de vérité — ce composant ne fait que refléter et déclencher).
 */
function ManualPublishPanel({
  courseId,
  platform,
  label,
  initialChecklist,
  initialUrl,
  onChanged,
}: ManualPublishPanelProps) {
  const { toast } = useToast();
  const t = useTranslations('course.deploy');
  const tApiError = useTranslations('apiErrors');
  const [items, setItems] = React.useState<DeployChecklistItem[]>(
    initialChecklist.length > 0 ? initialChecklist : initManualChecklist(platform),
  );
  const [url, setUrl] = React.useState(initialUrl ?? '');
  const [saving, setSaving] = React.useState(false);

  const canPublish = canPublishManually(items, url);

  /** Persiste l'état courant ; le serveur bascule en publié si les conditions sont réunies. */
  const persist = React.useCallback(
    async (nextItems: DeployChecklistItem[], nextUrl: string): Promise<void> => {
      setSaving(true);
      try {
        const res = await fetch(
          `/api/courses/${courseId}/deployments/${encodeURIComponent(platform)}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              externalUrl: nextUrl.trim() || undefined,
              checklist: nextItems.map((i) => ({ key: i.key, done: i.done })),
            }),
          },
        );
        const data = (await res.json().catch(() => null)) as
          | { published?: boolean; error?: string }
          | null;
        if (!res.ok) {
          toast({ variant: 'danger', title: t('toastSaveFailedTitle'), description: errorMessage(data, tApiError) });
          return;
        }
        if (data?.published) {
          toast({
            variant: 'success',
            title: t('toastPublishedTitle'),
            description: t('toastPublishedDesc', { platform: label }),
          });
        }
        onChanged();
      } catch {
        toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorDesc') });
      } finally {
        setSaving(false);
      }
    },
    [courseId, platform, label, toast, onChanged],
  );

  function toggle(key: string): void {
    const next = items.map((i) => (i.key === key ? { ...i, done: !i.done } : i));
    setItems(next);
    void persist(next, url);
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <UploadCloud className="size-3.5 text-accent" aria-hidden="true" />
          {t('manualPublishTitle')}
        </p>
        <Badge variant="draft" hideDot className="text-2xs">
          {t('stepsBadge', { done: doneCount, total: items.length })}
        </Badge>
      </div>
      <p className="text-2xs text-muted">
        {t('manualPublishIntro', { platform: label })}
      </p>

      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={item.done}
                disabled={saving}
                onChange={() => toggle(item.key)}
              />
              <span className={cn(item.done && 'text-muted line-through')}>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          label={t('urlLabel')}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            if (url.trim()) void persist(items, url);
          }}
          wrapperClassName="min-w-0 flex-1"
        />
        <Button
          variant="gold"
          loading={saving}
          disabled={!canPublish || saving}
          onClick={() => void persist(items, url)}
        >
          {!saving && <UploadCloud aria-hidden="true" />}
          {t('markPublishedButton')}
        </Button>
      </div>
      {!canPublish && (
        <p className="text-2xs text-muted">
          {t('cannotPublishHint')}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Matrice des capacités (plateforme × modes)                           */
/* ------------------------------------------------------------------ */

/**
 * Récapitulatif dépliable plateforme × modes supportés (P175). Chaque cellule
 * indique si le mode est disponible, et signale d'un triangle les combinaisons
 * à risque CGU (dérivées, cf. deployRiskFor). Purement informatif.
 */
function CapabilityMatrix({ catalog }: { catalog: CatalogEntry[] }) {
  const t = useTranslations('course.deploy');
  const [open, setOpen] = React.useState(false);
  if (catalog.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-surface-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-3 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Table2 className="size-4 text-muted" aria-hidden="true" />
          {t('capabilityMatrixTitle')}
        </span>
        <ChevronDown
          className={cn('size-4 text-muted transition-transform duration-fast', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border p-3">
          <table className="w-full min-w-[26rem] border-collapse text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-muted">
                <th className="p-2 text-start font-semibold">{t('colPlatform')}</th>
                {ALL_MODES.map((m) => (
                  <th key={m} className="p-2 text-center font-semibold">
                    {MODE_LABEL[m] ? t(MODE_LABEL[m]) : m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="p-2 font-medium text-foreground">{entry.label}</td>
                  {ALL_MODES.map((m) => {
                    const supported = entry.capabilities.modes.includes(m);
                    const risk = entry.risks[m];
                    return (
                      <td key={m} className="p-2 text-center">
                        {supported ? (
                          <span className="inline-flex items-center justify-center gap-1">
                            <Check className="size-3.5 text-success" aria-label={t('supported')} />
                            {risk && (
                              <AlertTriangle
                                className="size-3.5 text-accent"
                                aria-label={risk.label}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-muted" aria-label={t('notSupported')}>
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted">
            <AlertTriangle className="size-3 shrink-0 text-accent" aria-hidden="true" />
            {t('browserAutomationNote')}
          </p>
        </div>
      )}
    </div>
  );
}
