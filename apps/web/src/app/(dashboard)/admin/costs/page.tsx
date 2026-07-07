import type { Metadata } from 'next';
import type { Types } from 'mongoose';
import { Course, User, CostRecord, connectDb } from '@sallycourse/db';
import { COURSE_COST_ALERT_USD, type PlanId } from '@sallycourse/shared';
import { AdminNav } from '@/components/admin';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';
import { costByCourse, marginByPlan, type CostRow } from './cost-stats';

/**
 * Dashboard admin des coûts de génération (P55) : coût par cours (ventilé par
 * nature), marge par plan (revenu − coût), et alertes sur les cours qui
 * dépassent le seuil. Les montants sont ré-estimés depuis la table de tarifs
 * partagée à partir des métriques brutes conservées sur chaque CostRecord.
 */

export const metadata: Metadata = {
  title: 'Admin — Coûts — SallyCourse',
};

export const dynamic = 'force-dynamic';

/** Limite de cours affichés dans le tableau détaillé (les plus chers). */
const COURSE_LIMIT = 100;

const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const KIND_LABELS: Record<CostRow['kind'], string> = {
  claude: 'Claude',
  tts: 'Voix',
  render: 'Vidéo',
  image: 'Images',
};

export default async function AdminCostsPage() {
  await requireAdmin();
  await connectDb();

  // Lignes de coût brutes (métriques + contexte) — ré-estimation côté pur.
  const records = await CostRecord.find({})
    .select('courseId userId kind tokensIn tokensOut chars seconds model')
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
  }));

  const courseCosts = costByCourse(rows);

  // ── Marge par plan : coût par plan (via propriétaire → plan) + effectifs ──
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('plan')
    .lean();
  const planByUser = new Map(users.map((u) => [(u._id as Types.ObjectId).toString(), (u.plan as PlanId) ?? 'free']));

  const costByPlan: Record<string, number> = {};
  for (const c of courseCosts) {
    const plan = planByUser.get(c.userId) ?? 'free';
    costByPlan[plan] = (costByPlan[plan] ?? 0) + c.totalUsd;
  }

  // Effectifs par plan sur toute la base (revenu = prix × nb utilisateurs actifs).
  const planCounts = await User.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$plan', count: { $sum: 1 } } },
  ]);
  const activeUsersByPlan: Record<string, number> = {};
  for (const p of planCounts) activeUsersByPlan[p._id] = p.count;

  const margins = marginByPlan(costByPlan, activeUsersByPlan);

  // ── Titres des cours (jointure mémoire) + alertes ────────────────────────
  const shown = courseCosts.slice(0, COURSE_LIMIT);
  const courseIds = shown.map((c) => c.courseId);
  const courses = await Course.find({ _id: { $in: courseIds } })
    .select('title')
    .lean();
  const titleById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.title]));

  const alerts = courseCosts.filter((c) => c.overThreshold);
  const grandTotal = courseCosts.reduce((acc, c) => acc + c.totalUsd, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Coûts de génération</h1>
        <p className="mt-1 text-sm text-muted">
          Coût par cours, marge par plan et alertes. Estimé depuis la table de tarifs (seuil d’alerte :{' '}
          {usd2.format(COURSE_COST_ALERT_USD)}).
        </p>
      </div>

      <AdminNav />

      {/* Synthèse */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">Coût total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{usd2.format(grandTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">Cours suivis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{courseCosts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">Cours en alerte</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'font-display text-2xl font-semibold tabular-nums',
                alerts.length > 0 ? 'text-danger' : 'text-foreground',
              )}
            >
              {alerts.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Marge par plan */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Marge par plan</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Plan</th>
                <th className="px-4 py-3 text-end font-semibold">Revenu (USD)</th>
                <th className="px-4 py-3 text-end font-semibold">Coût (USD)</th>
                <th className="px-4 py-3 text-end font-semibold">Marge (USD)</th>
              </tr>
            </thead>
            <tbody>
              {margins.map((m) => {
                return (
                  <tr key={m.plan} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-foreground">{m.plan}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.revenueUsd)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.costUsd)}</td>
                    <td
                      className={cn(
                        'px-4 py-3 text-end font-semibold tabular-nums',
                        m.marginUsd < 0 ? 'text-danger' : 'text-foreground',
                      )}
                    >
                      {usd2.format(m.marginUsd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Coût par cours */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Coût par cours</h2>
        {shown.length === 0 ? (
          <EmptyState
            title="Aucun coût enregistré"
            description="Les coûts apparaissent dès qu’un cours passe par la génération (Claude, voix, vidéo, images)."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">Cours</th>
                  <th className="px-4 py-3 text-end font-semibold">Claude</th>
                  <th className="px-4 py-3 text-end font-semibold">Voix</th>
                  <th className="px-4 py-3 text-end font-semibold">Vidéo</th>
                  <th className="px-4 py-3 text-end font-semibold">Images</th>
                  <th className="px-4 py-3 text-end font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.courseId}
                    className={cn(
                      'border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30',
                      c.overThreshold && 'bg-danger/5',
                    )}
                  >
                    <td className="max-w-72 px-4 py-3">
                      <span className="flex items-center gap-2">
                        {c.overThreshold && (
                          <Badge variant="failed" hideDot className="text-2xs">
                            alerte
                          </Badge>
                        )}
                        <span className="block truncate font-medium text-foreground" title={titleById.get(c.courseId)}>
                          {titleById.get(c.courseId) ?? 'Cours supprimé'}
                        </span>
                      </span>
                      <span className="block truncate font-mono text-2xs text-muted">{c.courseId}</span>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.claude)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.tts)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.render)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.image)}</td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums text-foreground">
                      {usd.format(c.totalUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">
          Ventilation par nature — {Object.values(KIND_LABELS).join(' · ')}. Montants en USD.
        </p>
      </section>
    </div>
  );
}
