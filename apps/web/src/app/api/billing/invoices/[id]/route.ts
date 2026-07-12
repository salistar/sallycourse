import { isValidObjectId } from 'mongoose';
import { connectDb, Invoice, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { renderInvoiceHtml } from '@/lib/payments/invoice';

/**
 * GET /api/billing/invoices/[id] — facture au format HTML imprimable (P148),
 * même pattern que /api/learn/[courseId]/certificate : « imprimer → PDF »
 * navigateur, pas de dépendance Playwright côté web. Réservé au propriétaire
 * de la facture.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return Response.json({ error: 'Facture introuvable.' }, { status: 404 });
  }

  await connectDb();

  const invoice = await Invoice.findById(id).lean();
  if (!invoice || String(invoice.userId) !== user.id) {
    return Response.json({ error: 'Facture introuvable.' }, { status: 404 });
  }

  const owner = await UserModel.findById(invoice.userId).select('name email billingCompanyName').lean();
  const customerName = owner?.billingCompanyName || owner?.name || 'Client SallyCourse';

  const html = renderInvoiceHtml({
    invoiceNumber: invoice.invoiceNumber,
    plan: invoice.plan as 'pro' | 'business',
    price: { amountMinor: invoice.amountTTC, currency: invoice.currency },
    customerName,
    customerEmail: owner?.email ?? '',
    issuedAt: invoice.issuedAt,
    locale: invoice.locale,
    tax: {
      taxStatus: invoice.taxStatus,
      amountHTMinor: invoice.amountHT,
      tvaRate: invoice.tva,
      amountTvaMinor: invoice.amountTva,
      ice: invoice.ice || undefined,
      if: invoice.if || undefined,
    },
  });

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
