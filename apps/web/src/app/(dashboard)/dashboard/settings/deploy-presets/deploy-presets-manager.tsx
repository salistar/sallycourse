'use client';

import * as React from 'react';
import { Layers, Plus, Rocket, Share2, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  useToast,
} from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { getPlatformMeta } from '@/lib/platforms';

/** Plateforme d'un preset — miroir de IDeployPresetPlatform (packages/db). */
export interface PresetPlatformEntry {
  platform: string;
  mode: string;
  accountLabel?: string;
}

export interface PresetSummary {
  id: string;
  name: string;
  platforms: PresetPlatformEntry[];
  isPublic: boolean;
  /** true → preset de l'utilisateur courant (actions supprimer/partager visibles). */
  mine: boolean;
}

interface CourseOption {
  id: string;
  title: string;
}

const MODE_LABEL: Record<string, string> = {
  auto: 'modeAuto',
  assisted: 'modeAssisted',
  manual: 'modeManual',
};

function platformLabel(id: string): string {
  return getPlatformMeta(id)?.label ?? id;
}

interface DeployPresetsManagerProps {
  initialPresets: PresetSummary[];
  initialPublicPresets: PresetSummary[];
}

/**
 * Gestionnaire des presets de déploiement (P109) : liste mes presets +
 * presets publics, création (saisie manuelle de plateformes/modes), partage
 * public, suppression, et application en un clic à un cours choisi dans une
 * liste déroulante (chargée à la demande).
 */
export function DeployPresetsManager({ initialPresets, initialPublicPresets }: DeployPresetsManagerProps) {
  const { toast } = useToast();
  const t = useTranslations('settings.deployPresets');
  const _tApiError = useTranslations('apiErrors');
  const [presets, setPresets] = React.useState(initialPresets);
  const [publicPresets] = React.useState(initialPublicPresets);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [applyTarget, setApplyTarget] = React.useState<PresetSummary | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function handleDelete(preset: PresetSummary) {
    setBusy(`del:${preset.id}`);
    try {
      const res = await fetch(`/api/deploy-presets/${preset.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
      toast({ variant: 'success', title: t('toastDeletedTitle'), description: preset.name });
    } catch {
      toast({ variant: 'danger', title: t('toastDeleteErrorTitle'), description: t('toastDeleteErrorDesc') });
    } finally {
      setBusy(null);
    }
  }

  function handleCreated(preset: PresetSummary) {
    setPresets((prev) => [preset, ...prev]);
    setCreateOpen(false);
    toast({ variant: 'success', title: t('toastSavedTitle'), description: preset.name });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t('myPresets')}</h2>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" /> {t('newPreset')}
          </Button>
        </div>

        {presets.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted">
              {t('emptyState')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                busy={busy}
                onApply={() => setApplyTarget(preset)}
                onDelete={() => void handleDelete(preset)}
              />
            ))}
          </div>
        )}
      </section>

      {publicPresets.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('communityPresets')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {publicPresets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                busy={busy}
                onApply={() => setApplyTarget(preset)}
              />
            ))}
          </div>
        </section>
      )}

      <CreatePresetDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
      <ApplyPresetDialog preset={applyTarget} onOpenChange={(open) => !open && setApplyTarget(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carte preset                                                         */
/* ------------------------------------------------------------------ */

interface PresetCardProps {
  preset: PresetSummary;
  busy: string | null;
  onApply: () => void;
  onDelete?: () => void;
}

function PresetCard({ preset, busy, onApply, onDelete }: PresetCardProps) {
  const t = useTranslations('settings.deployPresets');
  const _tApiError = useTranslations('apiErrors');
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="size-4 text-accent" aria-hidden="true" />
            {preset.name}
          </CardTitle>
          {preset.isPublic && (
            <Badge variant="published" hideDot className="text-2xs">
              <Share2 className="size-3" aria-hidden="true" /> {t('publicBadge')}
            </Badge>
          )}
        </div>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted">
          {preset.platforms.map((p) => (
            <li key={p.platform}>
              {platformLabel(p.platform)} · {MODE_LABEL[p.mode] ? t(MODE_LABEL[p.mode]) : p.mode}
              {p.accountLabel ? ` · ${p.accountLabel}` : ''}
            </li>
          ))}
        </ul>
      </CardHeader>
      <CardContent className="mt-auto flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onApply}>
          <Rocket aria-hidden="true" /> {t('applyToCourse')}
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy === `del:${preset.id}`}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" /> {t('delete')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Création d'un preset                                                 */
/* ------------------------------------------------------------------ */

interface CreatePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (preset: PresetSummary) => void;
}

const KNOWN_PLATFORM_IDS = [
  'udemy',
  'youtube',
  'teachable',
  'thinkific',
  'podia',
  'gumroad',
  'skillshare',
  'moodle',
  'internal',
] as const;

function CreatePresetDialog({ open, onOpenChange, onCreated }: CreatePresetDialogProps) {
  const { toast } = useToast();
  const t = useTranslations('settings.deployPresets');
  const _tApiError = useTranslations('apiErrors');
  const [name, setName] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState('auto');
  const [isPublic, setIsPublic] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setName('');
      setSelected(new Set());
      setMode('auto');
      setIsPublic(false);
    }
  }, [open]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || selected.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/deploy-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          platforms: [...selected].map((platform) => ({ platform, mode })),
          isPublic,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { preset?: PresetSummary; error?: string }
        | null;
      if (!res.ok || !json?.preset) {
        toast({ variant: 'danger', title: t('createErrorTitle'), description: errorMessage(json, _tApiError) });
        return;
      }
      onCreated({ ...json.preset, mine: true });
    } catch {
      toast({ variant: 'danger', title: t('networkErrorTitle'), description: t('networkErrorDesc') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <Input
            label={t('presetNameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('presetNamePlaceholder')}
          />

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t('platforms')}</p>
            <div className="grid grid-cols-2 gap-2">
              {KNOWN_PLATFORM_IDS.map((id) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.has(id)}
                    onChange={() => toggle(id)}
                  />
                  {platformLabel(id)}
                </label>
              ))}
            </div>
          </div>

          <Select label={t('modeLabel')} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="auto">{t('modeAuto')}</option>
            <option value="assisted">{t('modeAssisted')}</option>
            <option value="manual">{t('modeManual')}</option>
          </Select>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">{t('sharePublicly')}</span>{' '}
              <span className="text-muted">{t('sharePubliclyHint')}</span>
            </span>
          </label>

          <DialogFooter>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={!name.trim() || selected.size === 0}
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Application à un cours                                               */
/* ------------------------------------------------------------------ */

interface ApplyPresetDialogProps {
  preset: PresetSummary | null;
  onOpenChange: (open: boolean) => void;
}

function ApplyPresetDialog({ preset, onOpenChange }: ApplyPresetDialogProps) {
  const { toast } = useToast();
  const t = useTranslations('settings.deployPresets');
  const _tApiError = useTranslations('apiErrors');
  const [courses, setCourses] = React.useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourse] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (!preset) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/courses');
        if (!cancelled && res.ok) {
          const data = (await res.json()) as {
            courses?: { id: string; title: string; status: string }[];
          };
          const ready = (data.courses ?? []).filter(
            (c) => c.status === 'ready' || c.status === 'published',
          );
          setCourses(ready.map((c) => ({ id: c.id, title: c.title })));
        }
      } catch {
        // Liste vide en cas d'échec — l'utilisateur peut réessayer.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset]);

  async function handleApply() {
    if (!preset || !selectedCourse) return;
    setApplying(true);
    try {
      const res = await fetch(
        `/api/courses/${selectedCourse}/apply-preset/${preset.id}`,
        { method: 'POST' },
      );
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('applyErrorTitle'), description: errorMessage(json, _tApiError) });
        return;
      }
      toast({
        variant: 'success',
        title: t('appliedTitle'),
        description: t('appliedDesc', { count: preset.platforms.length }),
      });
      onOpenChange(false);
    } catch {
      toast({ variant: 'danger', title: t('networkErrorTitle'), description: t('networkErrorDesc') });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={preset !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('applyDialogTitle', { name: preset?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-muted">{t('loadingCourses')}</p>
          ) : courses.length === 0 ? (
            <p className="text-sm text-muted">{t('noCoursesReady')}</p>
          ) : (
            <Select
              label={t('targetCourseLabel')}
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
            >
              <option value="">{t('selectCourse')}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            loading={applying}
            disabled={!selectedCourse}
            onClick={() => void handleApply()}
          >
            <Rocket aria-hidden="true" /> {t('launchDeploy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
