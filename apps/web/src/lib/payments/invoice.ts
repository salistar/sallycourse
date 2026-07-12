import { renderPdfTemplate, PdfTemplate } from '@sallycourse/design/pdf-templates';
import type { InvoicePdfInput } from '@sallycourse/design/pdf-templates';
import type { TaxStatus } from '@sallycourse/db';
import { formatAmount, PLAN_LABELS, type PaidPlanId, type PlanPrice } from './plans';
import { legalMentionFor, TAX_STATUS_LABELS } from './moroccan-tax';

/**
 * Génération de facture (P54, étendu P148 conformité fiscale Maroc). Réutilise
 * le gabarit PDF `invoice` (D10) pour produire le HTML imprimable d'une facture
 * d'abonnement mensuel. Le rendu PDF réel (Playwright/WeasyPrint) est fait côté
 * worker ; ici on produit le HTML prêt à imprimer — pas de dépendance Playwright
 * côté web (même pattern que /api/learn/[courseId]/certificate : « imprimer →
 * PDF » navigateur). Logique PURE.
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
  /**
   * Détail fiscal (P148) : montants HT/TVA/TTC déjà calculés (computeTaxBreakdown)
   * et identifiants marocains optionnels. Absent → comportement historique
   * inchangé (facture affiche uniquement le montant total, pas de ligne TVA
   * séparée ni d'ICE/IF — utilisateur hors Maroc ou statut non renseigné).
   */
  tax?: {
    taxStatus: TaxStatus;
    amountHTMinor: number;
    tvaRate: number;
    amountTvaMinor: number;
    ice?: string;
    if?: string;
  };
}

/** Construit un numéro de facture lisible : `SC-<YYYY>-<ref court>`. */
export function makeInvoiceNumber(providerRef: string, when: Date = new Date()): string {
  const year = when.getUTCFullYear();
  // Suffixe court, sûr pour un nom de fichier (alphanumérique majuscule).
  const short = providerRef.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase() || 'PAYMENT';
  return `SC-${year}-${short}`;
}

/** Formate un montant en plus petite unité (centimes) vers l'affichage devise. */
function formatMinor(amountMinor: number, currency: PlanPrice['currency'], intlLocale: string): string {
  return formatAmount({ amountMinor, currency }, intlLocale);
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
  const tax = params.tax;

  // Conformité fiscale Maroc (P148) : sous-total = HT, total = TTC, ligne d'article
  // annotée du taux de TVA. Sans `tax` (utilisateur hors Maroc / non renseigné) :
  // comportement historique inchangé (subtotal == total == montant payé).
  const subtotal = tax ? formatMinor(tax.amountHTMinor, params.price.currency, intlLocale) : amount;
  const itemSubtitle = tax
    ? `Facturation mensuelle · TVA ${(tax.tvaRate * 100).toFixed(0)}% (${formatMinor(tax.amountTvaMinor, params.price.currency, intlLocale)})`
    : 'Facturation mensuelle';

  // Ligne ICE/IF dédiée sous l'email client (société marocaine uniquement) —
  // champ séparé du gabarit, vide par défaut (aucun changement sans ces identifiants).
  const taxIdLine = tax
    ? [tax.ice ? `ICE : ${tax.ice}` : '', tax.if ? `IF : ${tax.if}` : ''].filter(Boolean).join(' · ')
    : '';

  const legalMention = tax ? legalMentionFor(tax.taxStatus) : '';
  const taxStatusLine = tax && tax.taxStatus !== 'unspecified' ? `Statut : ${TAX_STATUS_LABELS[tax.taxStatus]}. ` : '';
  const footerNote =
    `Merci de votre confiance. Cette facture est générée automatiquement ; ` +
    `aucune signature n’est requise. ${taxStatusLine}${legalMention}`.trim();

  const input: InvoicePdfInput = {
    lang: locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    invoiceNumber: params.invoiceNumber,
    issuedLine: `Émise le ${issued}`,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    taxIdLine,
    itemTitle: `Abonnement SallyCourse ${planLabel}`,
    itemSubtitle,
    itemAmount: amount,
    subtotal,
    total: amount,
    paidBadge: 'Payé',
    footerNote,
    // docTitle / labels : défauts français du gabarit.
  };
  return renderPdfTemplate(PdfTemplate.Invoice, input);
}
