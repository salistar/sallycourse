import {
  connectDb,
  Invoice as InvoiceModel,
  User as UserModel,
  type PaymentProvider,
  type TaxStatus,
} from '@sallycourse/db';
import { computeTaxBreakdown, tvaRateFor, DEFAULT_MOROCCO_TVA_RATE } from './moroccan-tax';
import { makeInvoiceNumber } from './invoice';
import { PLAN_PRICING, type PaidPlanId, type Currency } from './plans';
import { logger } from '@/lib/logger';

/**
 * Émission de facture à chaque paiement réussi (Prompt 148). Point d'appel
 * unique branché depuis les deux webhooks existants (P54) :
 *  - CMI callback (apps/web/src/app/api/payments/cmi/callback/route.ts)
 *  - Paddle/Lemon Squeezy webhook (apps/web/src/app/api/payments/paddle/webhook/route.ts)
 *
 * Idempotent par (provider, providerRef) — rejouer le même webhook (retry
 * réseau, callback dupliqué) ne crée pas deux factures pour un même paiement.
 * Best-effort : une erreur ici ne doit jamais faire échouer l'activation du
 * plan (le paiement reste valide même si la facture ne peut être émise).
 */

export interface IssueInvoiceInput {
  userId: string;
  plan: PaidPlanId;
  provider: PaymentProvider;
  /** Référence opaque du paiement — clé d'idempotence si fournie. */
  providerRef?: string;
  /** Devise du paiement (MAD via CMI, EUR via Paddle/Lemon). */
  currency: Currency;
  issuedAt?: Date;
}

export interface IssueInvoiceResult {
  ok: boolean;
  reason: string;
  invoiceId?: string;
  invoiceNumber?: string;
}

/**
 * Émet (ou retrouve, idempotence) la facture d'un paiement réussi. Calcule
 * HT/TVA/TTC selon le statut fiscal déclaré par l'utilisateur (billingTaxStatus) :
 * franchise de TVA pour un auto-entrepreneur, 20% standard pour une société ou
 * un statut non renseigné (comportement historique, factures internationales
 * incluses). Le PDF n'est PAS généré ici — servi à la demande, à l'identique du
 * certificat de complétion (GET /api/billing/invoices/[id], HTML imprimable).
 */
export async function issueInvoiceForPayment(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
  const price = PLAN_PRICING[input.plan]?.[input.currency];
  if (!price) {
    return { ok: false, reason: `Tarif inconnu pour ${input.plan}/${input.currency}.` };
  }

  await connectDb();

  // Idempotence : un paiement déjà facturé (même provider + providerRef) ne
  // génère pas de doublon — on renvoie la facture existante.
  if (input.providerRef) {
    const existing = await InvoiceModel.findOne({
      provider: input.provider,
      providerRef: input.providerRef,
    }).lean();
    if (existing) {
      return {
        ok: true,
        reason: 'Facture déjà émise (rejeu idempotent).',
        invoiceId: String(existing._id),
        invoiceNumber: existing.invoiceNumber,
      };
    }
  }

  const user = await UserModel.findById(input.userId)
    .select('billingTaxStatus billingIce billingIf')
    .lean();
  if (!user) {
    return { ok: false, reason: 'Utilisateur introuvable.' };
  }

  const taxStatus: TaxStatus = user.billingTaxStatus ?? 'unspecified';
  const tvaRate = tvaRateFor(taxStatus, DEFAULT_MOROCCO_TVA_RATE);

  // Le montant catalogue (PLAN_PRICING) est le montant TTC réellement facturé
  // au client (prix affiché sur /pricing) : on en dérive le HT selon le taux.
  const amountTTC = price.amountMinor;
  const amountHT =
    tvaRate === 0 ? amountTTC : Math.round(amountTTC / (1 + tvaRate));
  const breakdown = computeTaxBreakdown(amountHT, tvaRate);
  // Réajuste pour que amountHT + amountTva == amountTTC catalogue exactement
  // (évite un écart d'arrondi d'un centime entre le prix affiché et la facture).
  const amountTva = amountTTC - breakdown.amountHT;

  const issuedAt = input.issuedAt ?? new Date();
  const invoiceNumber = makeInvoiceNumber(input.providerRef ?? `${input.userId}-${issuedAt.getTime()}`, issuedAt);

  try {
    const invoice = await InvoiceModel.create({
      userId: input.userId,
      invoiceNumber,
      plan: input.plan,
      ice: user.billingIce || undefined,
      if: user.billingIf || undefined,
      taxStatus,
      amountHT: breakdown.amountHT,
      tva: tvaRate,
      amountTva,
      amountTTC,
      currency: input.currency,
      provider: input.provider,
      providerRef: input.providerRef,
      issuedAt,
      locale: 'fr',
    });
    return { ok: true, reason: 'Facture émise.', invoiceId: String(invoice._id), invoiceNumber };
  } catch (err) {
    // Course avec un doublon (deux webhooks concurrents pour le même paiement) :
    // l'index unique sur invoiceNumber/providerRef peut rejeter — best-effort,
    // on relit la facture qui a gagné la course plutôt que d'échouer.
    if (input.providerRef) {
      const raced = await InvoiceModel.findOne({
        provider: input.provider,
        providerRef: input.providerRef,
      }).lean();
      if (raced) {
        return {
          ok: true,
          reason: 'Facture déjà émise (course concurrente).',
          invoiceId: String(raced._id),
          invoiceNumber: raced.invoiceNumber,
        };
      }
    }
    logger.error({ err, userId: input.userId, provider: input.provider }, 'Émission de facture échouée');
    return { ok: false, reason: 'Émission de facture échouée.' };
  }
}
