import { connectDb, Invoice } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/billing/invoices — historique de facturation de l'utilisateur
 * connecté (P148), plus récent d'abord. Alimente settings/billing.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const invoices = await Invoice.find({ userId: user.id })
    .sort({ issuedAt: -1 })
    .select('invoiceNumber plan amountHT tva amountTva amountTTC currency issuedAt provider taxStatus')
    .limit(200)
    .lean();

  return Response.json({
    invoices: invoices.map((inv) => ({
      id: String(inv._id),
      invoiceNumber: inv.invoiceNumber,
      plan: inv.plan,
      amountHT: inv.amountHT,
      tva: inv.tva,
      amountTva: inv.amountTva,
      amountTTC: inv.amountTTC,
      currency: inv.currency,
      issuedAt: inv.issuedAt,
      provider: inv.provider,
      taxStatus: inv.taxStatus,
    })),
  });
}
