import { connectDb, Invoice, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { toMoroccanAccountingCsv, type InvoiceCsvRow } from '@/lib/payments/moroccan-tax';

/**
 * GET /api/billing/invoices/export — export comptable CSV (P148) de toutes
 * les factures de l'utilisateur connecté, colonnes standards marocaines
 * (date, ICE client, montant HT, TVA, TTC) — compatible import Sage/EBP
 * Maroc/Odoo MA. Logique de formatage PURE (toMoroccanAccountingCsv), seule
 * la lecture DB est ici.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const [invoices, owner] = await Promise.all([
    Invoice.find({ userId: user.id }).sort({ issuedAt: 1 }).lean(),
    UserModel.findById(user.id).select('name billingCompanyName').lean(),
  ]);

  const customerName = owner?.billingCompanyName || owner?.name || 'Client SallyCourse';

  const rows: InvoiceCsvRow[] = invoices.map((inv) => ({
    invoiceNumber: inv.invoiceNumber,
    issuedAt: inv.issuedAt,
    ice: inv.ice ?? '',
    if: inv.if ?? '',
    customerName,
    amountHT: inv.amountHT,
    tva: inv.tva,
    amountTva: inv.amountTva,
    amountTTC: inv.amountTTC,
    currency: inv.currency,
  }));

  const csv = toMoroccanAccountingCsv(rows);

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="sallycourse-factures.csv"',
    },
  });
}
