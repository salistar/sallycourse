import type { TaxStatus, InvoiceCurrency } from '@sallycourse/db';

/**
 * Conformité fiscale Maroc (Prompt 148). Logique PURE de calcul TVA/TTC et de
 * mentions légales — aucune I/O ici (la persistance/le rendu PDF vivent dans
 * invoice.ts et l'API webhook). Couvre les deux statuts déclarables par un
 * utilisateur SallyCourse marocain :
 *
 *  - `company` (société) : TVA à 20% (taux standard marocain sur les
 *    prestations de services numériques), ICE + IF obligatoires sur facture.
 *  - `auto_entrepreneur` : régime auto-entrepreneur marocain, PAS de TVA
 *    collectée (franchise) — mention légale obligatoire de non-assujettissement.
 *    ICE peut être présent (attribué par le CNSS) mais IF n'est généralement
 *    pas requis pour ce statut.
 *  - `unspecified` : l'utilisateur n'a pas renseigné son statut (ou n'est pas
 *    marocain) — comportement inchangé, TVA standard 20% par défaut, aucune
 *    mention spécifique Maroc, ICE/IF absents.
 *
 * Synergie SallyFiscal (autre projet SALISTAR, simulateur fiscal Maroc+France) :
 * les taux et libellés ci-dessous pourraient être partagés avec SallyFiscal
 * dans un futur package commun (@sallycourse/fiscal-fr-ma ?), mais aucune
 * intégration technique n'existe aujourd'hui — les deux projets restent
 * indépendants.
 */

/** Taux de TVA marocain standard (prestations de services), configurable par défaut à 20%. */
export const DEFAULT_MOROCCO_TVA_RATE = 0.2;

/** Taux de TVA appliqué à un auto-entrepreneur marocain — franchise, jamais collectée. */
export const AUTO_ENTREPRENEUR_TVA_RATE = 0;

/**
 * Taux de TVA applicable selon le statut fiscal déclaré. `unspecified` retombe
 * sur le taux standard passé en paramètre (défaut 20%, configurable) pour ne
 * rien changer au comportement existant (facturation internationale EUR).
 */
export function tvaRateFor(taxStatus: TaxStatus, standardRate: number = DEFAULT_MOROCCO_TVA_RATE): number {
  if (taxStatus === 'auto_entrepreneur') return AUTO_ENTREPRENEUR_TVA_RATE;
  return standardRate;
}

export interface TaxBreakdown {
  /** Montant HT, en plus petite unité (centimes). */
  amountHT: number;
  /** Taux appliqué (0.20 = 20%). */
  tva: number;
  /** Montant TVA, en plus petite unité, arrondi à l'entier le plus proche. */
  amountTva: number;
  /** Montant TTC = amountHT + amountTva, en plus petite unité. */
  amountTTC: number;
}

/**
 * Calcule le triptyque HT/TVA/TTC à partir d'un montant HT et d'un taux.
 * Tout est en plus petite unité (centimes) pour éviter les flottants ; l'arrondi
 * de la TVA se fait à l'unité mineure la plus proche (banker's rounding non
 * nécessaire ici — les montants sont des prix catalogue fixes, pas des sommes
 * accumulées).
 */
export function computeTaxBreakdown(amountHT: number, tva: number): TaxBreakdown {
  if (!Number.isFinite(amountHT) || amountHT < 0) {
    throw new Error(`computeTaxBreakdown : amountHT invalide (${amountHT})`);
  }
  if (!Number.isFinite(tva) || tva < 0 || tva > 1) {
    throw new Error(`computeTaxBreakdown : taux de TVA invalide (${tva})`);
  }
  const amountTva = Math.round(amountHT * tva);
  const amountTTC = amountHT + amountTva;
  return { amountHT, tva, amountTva, amountTTC };
}

/**
 * Calcule le triptyque HT/TVA/TTC à partir d'un montant TTC connu (cas des
 * webhooks Paddle/CMI qui fournissent le montant total payé) : on retro-calcule
 * le HT à partir du taux, l'arrondi se fait au centime le plus proche de sorte
 * que amountHT + amountTva == amountTTC exactement (pas d'écart d'arrondi).
 */
export function breakdownFromTTC(amountTTC: number, tva: number): TaxBreakdown {
  if (!Number.isFinite(amountTTC) || amountTTC < 0) {
    throw new Error(`breakdownFromTTC : amountTTC invalide (${amountTTC})`);
  }
  if (!Number.isFinite(tva) || tva < 0 || tva > 1) {
    throw new Error(`breakdownFromTTC : taux de TVA invalide (${tva})`);
  }
  const amountHT = Math.round(amountTTC / (1 + tva));
  const amountTva = amountTTC - amountHT;
  return { amountHT, tva, amountTva, amountTTC };
}

/** Libellés des statuts fiscaux (affichage settings + factures). */
export const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  auto_entrepreneur: 'Auto-entrepreneur',
  company: 'Société',
  unspecified: 'Non renseigné',
};

/**
 * Mention légale obligatoire à faire figurer sur la facture selon le statut
 * fiscal — franchise de TVA pour l'auto-entrepreneur marocain, mention neutre
 * sinon. Vide pour `unspecified` (aucune mention Maroc si le statut n'a pas
 * été déclaré).
 */
export function legalMentionFor(taxStatus: TaxStatus): string {
  if (taxStatus === 'auto_entrepreneur') {
    return 'TVA non applicable, article 89 du Code Général des Impôts (régime auto-entrepreneur, Maroc).';
  }
  if (taxStatus === 'company') {
    return 'TVA au taux normal de 20% conformément à la législation marocaine en vigueur.';
  }
  return '';
}

/** Vrai si le statut fiscal exige ICE + IF sur la facture (société marocaine). */
export function requiresIceAndIf(taxStatus: TaxStatus): boolean {
  return taxStatus === 'company';
}

/**
 * Valide un ICE marocain — 15 chiffres exactement (format officiel CNSS/DGI).
 * Ne lève jamais : retourne un booléen, la validation stricte est laissée au
 * formulaire (message d'erreur localisé).
 */
export function isValidIce(value: string): boolean {
  return /^\d{15}$/.test(value.trim());
}

/**
 * Valide un IF marocain — de 6 à 8 chiffres (format DGI, longueur variable
 * selon l'ancienneté de l'identifiant).
 */
export function isValidIf(value: string): boolean {
  return /^\d{6,8}$/.test(value.trim());
}

/* ------------------------------------------------------------------ */
/* Export comptable CSV (compatible logiciels marocains)               */
/* ------------------------------------------------------------------ */

export interface InvoiceCsvRow {
  invoiceNumber: string;
  issuedAt: Date;
  /** ICE du client — vide si non renseigné (auto-entrepreneur/particulier). */
  ice: string;
  /** IF du client — vide si non renseigné. */
  if: string;
  customerName: string;
  amountHT: number;
  tva: number;
  amountTva: number;
  amountTTC: number;
  currency: InvoiceCurrency;
}

/** Échappe une valeur pour une cellule CSV (RFC 4180 minimal : guillemets si virgule/quote/saut de ligne). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Formate un montant en plus petite unité vers une décimale (centimes → unité), 2 décimales fixes. */
function formatMinorAsDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/**
 * Export comptable CSV compatible logiciels marocains (Sage, EBP Maroc,
 * Odoo MA…) : colonnes standards attendues par la majorité des imports —
 * date, ICE client, raison sociale, montant HT, taux TVA, montant TVA, TTC,
 * devise, numéro de facture. En-têtes en français, séparateur virgule, point
 * décimal (format universel, indépendant de la locale système).
 */
export function toMoroccanAccountingCsv(rows: InvoiceCsvRow[]): string {
  const header = [
    'date',
    'numero_facture',
    'ice_client',
    'if_client',
    'client',
    'montant_ht',
    'taux_tva',
    'montant_tva',
    'montant_ttc',
    'devise',
  ].join(',');

  const lines = rows
    .slice()
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime())
    .map((r) =>
      [
        csvCell(r.issuedAt.toISOString().slice(0, 10)),
        csvCell(r.invoiceNumber),
        csvCell(r.ice),
        csvCell(r.if),
        csvCell(r.customerName),
        csvCell(formatMinorAsDecimal(r.amountHT)),
        csvCell((r.tva * 100).toFixed(0) + '%'),
        csvCell(formatMinorAsDecimal(r.amountTva)),
        csvCell(formatMinorAsDecimal(r.amountTTC)),
        csvCell(r.currency),
      ].join(','),
    );

  return [header, ...lines].join('\n');
}
