import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { CostRecord, connectDb } from '@sallycourse/db';
import { AdminNav, StatCard } from '@/components/admin';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';
import { costByProvider, type CostRow } from '../costs/cost-stats';
import { fetchAllProviderCredits, type CreditStatus } from './provider-credits';
import {
  fetchWorkerMetrics,
  severityForPercent,
  formatBytes,
  DISK_WARN_PERCENT,
  DISK_CRIT_PERCENT,
  MEM_WARN_PERCENT,
  MEM_CRIT_PERCENT,
  type ResourceSeverity,
} from './server-metrics';

/**
 * Dashboard « Ops » super-admin (audit qualité 2026-07-29) : crédits des
 * providers LLM/Modal en direct, ressources serveur (disque/RAM/CPU, lues
 * depuis le worker via /metrics.json interne), débit des files BullMQ, et
 * temps d'appel réel par provider (TTS/image/transcription/LLM cloud, dont
 * Modal) — trois angles morts identifiés pendant l'audit vidéo/voix : on ne
 * savait ni quels providers étaient à sec, ni si le serveur saturait, ni
 * combien de temps Modal prenait réellement par appel.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.ops');
  return { title: t('metaTitle') };
}

export const dynamic = 'force-dynamic';

const CREDIT_BADGE: Record<CreditStatus, 'published' | 'generating' | 'failed' | 'draft'> = {
  ok: 'published',
  low: 'generating',
  exhausted: 'failed',
  unknown: 'draft',
  not_configured: 'draft',
};

const RESOURCE_BADGE: Record<ResourceSeverity, 'published' | 'generating' | 'failed'> = {
  ok: 'published',
  warning: 'generating',
  critical: 'failed',
};

const KIND_LABELS: Record<CostRow['kind'], string> = {
  claude: 'Texte (LLM)',
  tts: 'Voix (TTS)',
  render: 'Rendu vidéo',
  image: 'Image',
  transcribe: 'Sous-titres',
  avatar: 'Avatar',
};

const msFmt = (ms: number | null): string => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export default async function AdminOpsPage() {
  await requireAdmin('ops');
  await connectDb();

  const t = await getTranslations('admin.ops');

  const [credits, workerMetrics, costRecords] = await Promise.all([
    fetchAllProviderCredits(),
    fetchWorkerMetrics(),
    CostRecord.find({ durationMs: { $exists: true } })
      .select('courseId userId kind tokensIn tokensOut chars seconds model createdAt durationMs')
      .lean(),
  ]);

  const rows: CostRow[] = costRecords.map((r) => ({
    courseId: String(r.courseId),
    userId: String(r.userId),
    kind: r.kind,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    chars: r.chars,
    seconds: r.seconds,
    model: r.model,
    createdAt: r.createdAt,
    durationMs: r.durationMs,
  }));
  const timedProviders = costByProvider(rows).filter((p) => p.durationMsSamples > 0);

  const alertingCredits = credits.filter((c) => c.status === 'exhausted' || c.status === 'low');
  const system = workerMetrics?.system;
  const diskSeverity = system ? severityForPercent(system.diskUsedPercent, DISK_WARN_PERCENT, DISK_CRIT_PERCENT) : 'ok';
  const memSeverity = system ? severityForPercent(system.memUsedPercent, MEM_WARN_PERCENT, MEM_CRIT_PERCENT) : 'ok';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <AdminNav />

      {alertingCredits.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-danger">{t('alerts.creditsTitle')}</p>
            <p className="mt-1 text-sm text-foreground">
              {alertingCredits.map((c) => c.label).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* ── Crédits providers ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.credits')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {credits.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm text-foreground">{c.label}</CardTitle>
                  <Badge variant={CREDIT_BADGE[c.status]}>{t(`creditStatus.${c.status}`)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {c.balanceUsd !== undefined ? (
                  <p className="font-display text-xl font-semibold tabular-nums text-foreground">
                    {c.balanceUsd.toFixed(2)} $
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted">{c.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-2xs text-muted">{t('sections.creditsNote')}</p>
      </section>

      {/* ── Ressources serveur ────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.server')}</h2>
        {!system ? (
          <EmptyState title={t('server.unreachableTitle')} description={t('server.unreachableDescription')} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label={t('server.disk')}
                icon={<HardDrive />}
                value={
                  <span className={diskSeverity !== 'ok' ? 'text-danger' : undefined}>
                    {system.diskUsedPercent.toFixed(0)}%
                  </span>
                }
                hint={t('server.diskHint', {
                  used: formatBytes(system.diskTotalBytes - system.diskFreeBytes),
                  total: formatBytes(system.diskTotalBytes),
                })}
              />
              <StatCard
                label={t('server.memory')}
                icon={<MemoryStick />}
                value={
                  <span className={memSeverity !== 'ok' ? 'text-danger' : undefined}>
                    {system.memUsedPercent.toFixed(0)}%
                  </span>
                }
                hint={t('server.memHint', {
                  used: formatBytes(system.memTotalBytes - system.memFreeBytes),
                  total: formatBytes(system.memTotalBytes),
                })}
              />
              <StatCard
                label={t('server.load')}
                icon={<Cpu />}
                value={system.loadAvg1.toFixed(2)}
                hint={t('server.loadHint', { cpus: system.cpuCount, load5: system.loadAvg5.toFixed(2) })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface/60 p-4">
                <div className="flex items-center justify-between text-2xs uppercase tracking-wide text-muted">
                  <span>{t('server.disk')}</span>
                  <Badge variant={RESOURCE_BADGE[diskSeverity]}>{t(`resourceSeverity.${diskSeverity}`)}</Badge>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      diskSeverity === 'critical' ? 'bg-danger' : diskSeverity === 'warning' ? 'bg-accent' : 'bg-success',
                    )}
                    style={{ width: `${Math.min(100, system.diskUsedPercent)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface/60 p-4">
                <div className="flex items-center justify-between text-2xs uppercase tracking-wide text-muted">
                  <span>{t('server.memory')}</span>
                  <Badge variant={RESOURCE_BADGE[memSeverity]}>{t(`resourceSeverity.${memSeverity}`)}</Badge>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      memSeverity === 'critical' ? 'bg-danger' : memSeverity === 'warning' ? 'bg-accent' : 'bg-success',
                    )}
                    style={{ width: `${Math.min(100, system.memUsedPercent)}%` }}
                  />
                </div>
              </div>
            </div>
            <p className="text-2xs text-muted">
              {t('server.uptimeNote', { hours: Math.round(system.uptimeSec / 3600) })}
            </p>
          </>
        )}
      </section>

      {/* ── Débit des files (jobs/heure, échecs) ──────────────────── */}
      {workerMetrics && workerMetrics.queues.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.queues')}</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('queues.colQueue')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('queues.colPerHour')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('queues.colAvgDuration')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('queues.colCompleted')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('queues.colFailed')}</th>
                </tr>
              </thead>
              <tbody>
                {workerMetrics.queues.map((q) => (
                  <tr key={q.queue} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-foreground">{q.queue}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{q.jobsPerHour.toFixed(1)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{msFmt(Math.round(q.avgDurationMs))}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{q.completed}</td>
                    <td className={cn('px-4 py-3 text-end tabular-nums', q.failed > 0 ? 'text-danger' : 'text-muted')}>
                      {q.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Temps par provider (dont Modal) ───────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.timing')}</h2>
        {timedProviders.length === 0 ? (
          <EmptyState title={t('timing.emptyTitle')} description={t('timing.emptyDescription')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('timing.colProvider')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('timing.colKind')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('timing.colCalls')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('timing.colAvg')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('timing.colP95')}</th>
                </tr>
              </thead>
              <tbody>
                {timedProviders.map((p) => (
                  <tr key={`${p.kind}::${p.provider}`} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-foreground">{p.provider}</td>
                    <td className="px-4 py-3 text-muted">{KIND_LABELS[p.kind]}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">
                      {p.durationMsSamples}
                      {p.durationMsSamples < p.calls ? (
                        <span className="text-2xs"> / {p.calls}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-foreground">{msFmt(p.avgDurationMs)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{msFmt(p.p95DurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">{t('timing.note')}</p>
      </section>
    </div>
  );
}
