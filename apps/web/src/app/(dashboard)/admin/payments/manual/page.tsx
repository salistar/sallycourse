import type { Metadata } from 'next';
import type { Types } from 'mongoose';
import { connectDb, ManualPaymentRequest, User } from '@sallycourse/db';
import type { ManualPaymentStatus } from '@sallycourse/db';
import { AdminNav, PendingButton } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { requireAdmin } from '../../guard';
import { PLAN_LABELS } from '@/lib/payments/plans';
import { approveManualPaymentAction, rejectManualPaymentAction } from './actions';
import { RejectForm } from './reject-form';

/**
 * File des demandes de paiement manuel (Prompt 158) : virement bancaire
 * international à zéro commission, alternative à Paddle. Chaque demande est
 * revue à la main — approuver active le plan (comme le webhook CMI/Paddle),
 * rejeter clôture avec un motif. Les demandes déjà traitées restent visibles
 * (historique), triées plus récentes d'abord.
 */

export const metadata: Metadata = {
  title: 'Admin — Paiements manuels — SallyCourse',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

const STATUS_BADGE: Record<ManualPaymentStatus, 'generating' | 'ready' | 'failed'> = {
  pending: 'generating',
  approved: 'ready',
  rejected: 'failed',
};

const STATUS_LABEL: Record<ManualPaymentStatus, string> = {
  pending: 'En attente',
  approved: 'Approuvée',
  rejected: 'Rejetée',
};

/** Formate un montant en plus petite unité selon la devise déclarée. */
function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

export default async function AdminManualPaymentsPage() {
  await requireAdmin('payments-manual');
  await connectDb();

  const [requests, users] = await Promise.all([
    ManualPaymentRequest.find().sort({ createdAt: -1 }).limit(PAGE_SIZE).lean(),
    User.find().select('email name').lean(),
  ]);
  const userById = new Map(users.map((u) => [(u._id as Types.ObjectId).toString(), u]));

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Paiements manuels</h1>
        <p className="mt-1 text-sm text-muted">
          Virements bancaires internationaux (zéro commission) en attente de validation —
          {' '}
          {pendingCount} en attente sur {requests.length} demandes.
        </p>
      </div>

      <AdminNav />

      {requests.length === 0 ? (
        <EmptyState
          title="Aucune demande"
          description="Aucun utilisateur n'a encore soumis de demande de paiement manuel."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[68rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Utilisateur</th>
                <th className="px-4 py-3 text-start font-semibold">Plan</th>
                <th className="px-4 py-3 text-start font-semibold">Montant déclaré</th>
                <th className="px-4 py-3 text-start font-semibold">Preuve</th>
                <th className="px-4 py-3 text-start font-semibold">Statut</th>
                <th className="px-4 py-3 text-start font-semibold">Soumise</th>
                <th className="px-4 py-3 text-end font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const id = (r._id as Types.ObjectId).toString();
                const userId = r.userId.toString();
                const user = userById.get(userId);
                const isPending = r.status === 'pending';

                return (
                  <tr key={id} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                    <td className="max-w-64 px-4 py-3">
                      <span className="block truncate font-medium text-foreground" title={user?.name}>
                        {user?.name ?? '(utilisateur supprimé)'}
                      </span>
                      <span className="block truncate text-2xs text-muted" title={user?.email}>
                        {user?.email ?? userId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {PLAN_LABELS[r.plan as keyof typeof PLAN_LABELS] ?? r.plan}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {formatMinor(r.amountRequested, r.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {r.proofUrl ? (
                        <a
                          href={`/api/admin/payments/manual/${id}/proof`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary-500 underline underline-offset-2 hover:text-primary-600"
                        >
                          Voir la preuve
                        </a>
                      ) : (
                        <span className="text-2xs text-muted">Aucune</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[r.status as ManualPaymentStatus]} className="text-2xs">
                        {STATUS_LABEL[r.status as ManualPaymentStatus]}
                      </Badge>
                      {r.status === 'rejected' && r.rejectionReason ? (
                        <span className="mt-1 block max-w-56 truncate text-2xs text-muted" title={r.rejectionReason}>
                          {r.rejectionReason}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {dateFmt.format(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {isPending ? (
                        <div className="flex items-center justify-end gap-2">
                          <form action={approveManualPaymentAction}>
                            <input type="hidden" name="requestId" value={id} />
                            <PendingButton variant="secondary" size="sm">
                              Approuver
                            </PendingButton>
                          </form>
                          <RejectForm requestId={id} action={rejectManualPaymentAction} />
                        </div>
                      ) : (
                        <span className="text-2xs text-muted">Traitée</span>
                      )}
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
