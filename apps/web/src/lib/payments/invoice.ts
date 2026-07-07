import { renderPdfTemplate, PdfTemplate } from '@sallycourse/design/pdf-templates';
import type { InvoicePdfInput } from '@sallycourse/design/pdf-templates';
import { formatAmount, PLAN_LABELS, type PaidPlanId, type PlanPrice } from './plans';

/**
 * Génération de facture (P54). Réutilise le gabarit PDF `invoice` (D10) pour
 * produire le HTML imprimable d'une facture d'abonnement mensuel. Le rendu
 * PDF réel (Playwright/WeasyPrint) est fait côté worker ; ici on produit le
 * HTML prêt à imprimer — pas de dépendance Playwright côté web. Logique PURE.
 */

/** Locales Intl pour formater dates et montants dans la langue du client. */
const DATE_LOCALES: Record<string, string> = { fr: 'fr-FR', en: 'en-US', ar: 'ar-MA' };

export interface InvoiceParams {
  /** Numéro de facture unique et stable (dérivé de la référence de paiement). */
  invoiceNumber: string;
  plan: PaidPlanId;
  price: PlanPrice;
  customerName: string;
  customerEmail: string;
  /** Date d'émission ; défaut = maintenant. */
  issuedAt?: Date;
  locale?: 'fr' | 'en' | 'ar';
}

/** Construit un numéro de facture lisible : `SC-<YYYY>-<ref court>`. */
export function makeInvoiceNumber(providerRef: string, when: Date = new Date()): string {
  const year = when.getUTCFullYear();
  // Suffixe court, sûr pour un nom de fichier (alphanumérique majuscule).
  const short = providerRef.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase() || 'PAYMENT';
  return `SC-${year}-${short}`;
}

/** Rend le HTML imprimable d'une facture d'abonnement mensuel. */
export function renderInvoiceHtml(params: InvoiceParams): string {
  const when = params.issuedAt ?? new Date();
  const locale = params.locale ?? 'fr';
  const intlLocale = DATE_LOCALES[locale] ?? 'fr-FR';

  const issued = new Intl.DateTimeFormat(intlLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(when);

  const amount = formatAmount(params.price, intlLocale);
  const planLabel = PLAN_LABELS[params.plan];

  const input: InvoicePdfInput = {
    lang: locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    invoiceNumber: params.invoiceNumber,
    issuedLine: `Émise le ${issued}`,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    itemTitle: `Abonnement SallyCourse ${planLabel}`,
    itemSubtitle: 'Facturation mensuelle',
    itemAmount: amount,
    subtotal: amount,
    total: amount,
    paidBadge: 'Payé',
    footerNote:
      'Merci de votre confiance. Cette facture est générée automatiquement ; ' +
      'aucune signature n’est requise.',
    // docTitle / labels : défauts français du gabarit.
  };
  return renderPdfTemplate(PdfTemplate.Invoice, input);
}
