import { requireApiUser } from '@/lib/session';
import { loadAllRevenueEntries } from '@/lib/revenue-data';
import { toAccountingCsv } from '@/lib/revenue-aggregate';

// Export comptable : jamais de cache, runtime Node (accès Mongo).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/revenue/export — export comptable CSV du revenu consolidé
 * (P99). Colonnes : date, source, montant (devise d'origine), devise, montant
 * converti (USD). Réservé aux admins.
 */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return Response.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 });
  }

  const entries = await loadAllRevenueEntries();
  const csv = toAccountingCsv(entries, 'USD');
  const filename = `sallycourse-revenus-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
