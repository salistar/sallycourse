import { Types } from 'mongoose';
import { getTranslations } from 'next-intl/server';
import { connectDb, Course, CostRecord } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import {
  costByCourse,
  costByProvider,
  rowCostUsd,
  usageTimeline,
  totalCostUsd,
  type CostRow,
} from '../../admin/costs/cost-stats';
import { ProviderUsageBars, UsageTimelineChart } from '../../admin/costs/usage-charts';
import type { CostKind } from '@sallycourse/shared';
import { cn } from '@/lib/cn';

/**
 * Statistiques & analytique UTILISATEUR (2026-07-26) : consommation par
 * provider IA (modèles LLM), par app Modal (Chatterbox/Qwen3-TTS, Whisper,
 * SDXL/Z-Image, avatar) et coûts estimés — MES cours uniquement (scope
 * userId, contrairement au dashboard admin qui agrège tout le monde).
 * Réutilise les agrégats purs + graphes CSS du dashboard admin.
 */

export const dynamic = 'force-dynamic';

const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const COURSE_LIMIT = 20;

export default async function UserStatsPage() {
  const user = await requireUser();
  await connectDb();
  const t = await getTranslations('stats');

  // Scope STRICT au propriétaire connecté — c'est la différence avec /admin/costs.
  const records = await CostRecord.find({ userId: user.id })
    .select('courseId userId kind tokensIn tokensOut chars seconds model createdAt')
    .lean();

  const rows: CostRow[] = records.map((r) => ({
    courseId: String(r.courseId),
    userId: String(r.userId),
    kind: r.kind,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    chars: r.chars,
    seconds: r.seconds,
    model: r.model,
    createdAt: r.createdAt,
  }));

  const total = totalCostUsd(rows);
  const providerUsage = costByProvider(rows);
  const today = new Date().toISOString().slice(0, 10);
  const timeline = usageTimeline(rows, today, 30);
  const courseCosts = costByCourse(rows).slice(0, COURSE_LIMIT);

  const courses = await Course.find({ _id: { $in: courseCosts.map((c) => c.courseId) } })
    .select('title')
    .lean();
  const titleById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.title]));

  const courseCount = new Set(rows.map((r) => r.courseId)).size;
  const avgPerCourse = courseCount > 0 ? total / courseCount : 0;

  // Répartition du coût par NATURE (2026-07-26) : où part l'argent (LLM, voix,
  // vidéo, images, transcription, avatar). Réutilise les libellés du dashboard
  // admin pour ne pas dupliquer d'i18n.
  const tKind = await getTranslations('admin.usageCharts');
  const KIND_META: { kind: CostKind; bar: string }[] = [
    { kind: 'claude', bar: 'bg-primary' },
    { kind: 'tts', bar: 'bg-accent' },
    { kind: 'render', bar: 'bg-warning' },
    { kind: 'image', bar: 'bg-success' },
    { kind: 'transcribe', bar: 'bg-info' },
    { kind: 'avatar', bar: 'bg-danger' },
  ];
  const byNature: Record<CostKind, number> = {
    claude: 0, tts: 0, render: 0, image: 0, transcribe: 0, avatar: 0,
  };
  for (const r of rows) byNature[r.kind] += rowCostUsd(r);
  const natureMax = Math.max(...Object.values(byNature), 0.0001);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </header>

      {/* ── Indicateurs clés ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-2xs uppercase tracking-wide text-muted">{t('kpiTotalCost')}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{usd2.format(total)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-2xs uppercase tracking-wide text-muted">{t('kpiCalls')}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{rows.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-2xs uppercase tracking-wide text-muted">{t('kpiCourses')}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{courseCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-2xs uppercase tracking-wide text-muted">{t('kpiAvgPerCourse')}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{usd2.format(avgPerCourse)}</p>
        </div>
      </div>

      {/* ── Répartition du coût par nature ── */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t('byNatureTitle')}</h2>
        <ul className="flex flex-col gap-2">
          {KIND_META.map(({ kind, bar }) => {
            const value = byNature[kind];
            const pct = total > 0 ? (value / total) * 100 : 0;
            const width = Math.max(2, (value / natureMax) * 100);
            return (
              <li key={kind} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 text-muted">{tKind(`kind.${kind}`)}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-subtle">
                  <div className={cn('h-full rounded', bar)} style={{ width: `${width}%` }} />
                </div>
                <span className="w-20 shrink-0 text-end tabular-nums text-foreground">{usd.format(value)}</span>
                <span className="w-12 shrink-0 text-end tabular-nums text-muted">{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Historique 30 jours ── */}
      <UsageTimelineChart days={timeline} />

      {/* ── Consommation par provider / modèle (LLM, apps Modal, moteurs) ── */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">{t('providersTitle')}</h2>
        <p className="mb-3 text-2xs text-muted">{t('providersHint')}</p>
        <ProviderUsageBars providers={providerUsage} />
      </section>

      {/* ── Coût par cours ── */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t('byCourseTitle')}</h2>
        {courseCosts.length === 0 ? (
          <p className="text-2xs text-muted">{t('noData')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="py-2 text-start">{t('colCourse')}</th>
                  <th className="py-2 text-end">{t('colText')}</th>
                  <th className="py-2 text-end">{t('colVoice')}</th>
                  <th className="py-2 text-end">{t('colMedia')}</th>
                  <th className="py-2 text-end">{t('colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {courseCosts.map((c) => (
                  <tr key={c.courseId} className="border-b border-border/50">
                    <td className="max-w-64 truncate py-2 pe-3 text-foreground">
                      {titleById.get(c.courseId) ?? c.courseId}
                    </td>
                    <td className="py-2 text-end tabular-nums text-muted">{usd.format(c.byKind.claude)}</td>
                    <td className="py-2 text-end tabular-nums text-muted">{usd.format(c.byKind.tts)}</td>
                    <td className="py-2 text-end tabular-nums text-muted">
                      {usd.format(c.byKind.render + c.byKind.image + c.byKind.transcribe + c.byKind.avatar)}
                    </td>
                    <td className="py-2 text-end font-medium tabular-nums text-foreground">{usd.format(c.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
