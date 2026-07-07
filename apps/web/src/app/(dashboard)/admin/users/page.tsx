import type { Metadata } from 'next';
import type { Types } from 'mongoose';
import { Ban, RotateCcw } from 'lucide-react';
import { Course, User, connectDb } from '@sallycourse/db';
import { PLANS, type PlanId } from '@sallycourse/shared';
import { AdminNav, PendingButton } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { requireAdmin } from '../guard';
import { estimatedCost, formatCost, planUsageRatio } from '../stats';
import { PlanSelect } from './plan-select';
import { setBannedAction } from './actions';

/**
 * Gestion des utilisateurs (P57) : liste avec plan, usage du mois, coût
 * estimé et actions (bannir/réactiver, changer de plan). Le nombre total de
 * cours par utilisateur vient d'une agrégation ($group), jointe en mémoire.
 */

export const metadata: Metadata = {
  title: 'Admin — Utilisateurs — SallyCourse',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const numberFmt = new Intl.NumberFormat('fr-FR');
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  await connectDb();

  const [users, courseCounts] = await Promise.all([
    User.find()
      .select('email name plan role banned quotaUsed createdAt')
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE)
      .lean(),
    // Total de cours généré par utilisateur — agrégation efficace côté Mongo.
    Course.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]),
  ]);

  const totalCoursesByUser = new Map(courseCounts.map((c) => [c._id.toString(), c.count]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Utilisateurs</h1>
        <p className="mt-1 text-sm text-muted">
          {numberFmt.format(users.length)} comptes les plus récents — plan, usage et coûts estimés.
        </p>
      </div>

      <AdminNav />

      {users.length === 0 ? (
        <EmptyState title="Aucun utilisateur" description="La base ne contient encore aucun compte." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[68rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Utilisateur</th>
                <th className="px-4 py-3 text-start font-semibold">Plan</th>
                <th className="px-4 py-3 text-start font-semibold">Usage du mois</th>
                <th className="px-4 py-3 text-start font-semibold">Cours (total)</th>
                <th className="px-4 py-3 text-start font-semibold">Coût estimé</th>
                <th className="px-4 py-3 text-start font-semibold">Inscrit</th>
                <th className="px-4 py-3 text-end font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const id = (u._id as Types.ObjectId).toString();
                const plan = u.plan as PlanId;
                const limit = PLANS[plan].coursesPerMonth;
                const used = u.quotaUsed?.coursesThisMonth ?? 0;
                const ratio = planUsageRatio(used, limit);
                const totalCourses = totalCoursesByUser.get(id) ?? 0;
                const cost = estimatedCost(totalCourses);
                const isSelf = id === admin.id;
                const limitLabel = Number.isFinite(limit) ? numberFmt.format(limit) : '∞';

                return (
                  <tr key={id} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                    <td className="max-w-64 px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className="block truncate font-medium text-foreground" title={u.name}>
                          {u.name}
                        </span>
                        {u.role === 'admin' ? (
                          <Badge variant="ready" hideDot className="text-2xs">
                            admin
                          </Badge>
                        ) : null}
                        {u.banned ? (
                          <Badge variant="failed" hideDot className="text-2xs">
                            banni
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-2xs text-muted" title={u.email}>
                        {u.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PlanSelect userId={id} current={plan} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-subtle">
                          <div
                            className="h-full rounded-full bg-primary-400/80"
                            style={{ width: `${(ratio ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-xs text-muted">
                          {numberFmt.format(used)}/{limitLabel}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {numberFmt.format(totalCourses)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{formatCost(cost)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {dateFmt.format(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <form action={setBannedAction} className="inline-flex">
                        <input type="hidden" name="userId" value={id} />
                        <input type="hidden" name="banned" value={u.banned ? 'false' : 'true'} />
                        <PendingButton
                          variant={u.banned ? 'secondary' : 'ghost'}
                          size="sm"
                          disabled={isSelf}
                          title={isSelf ? 'Action impossible sur votre propre compte' : undefined}
                        >
                          {u.banned ? <RotateCcw aria-hidden="true" /> : <Ban aria-hidden="true" />}
                          {u.banned ? 'Réactiver' : 'Bannir'}
                        </PendingButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
