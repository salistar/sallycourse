import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { PLANS, type PlanId } from '@sallycourse/shared';

// Identifiants de plan dérivés de la constante partagée (free|pro|business).
const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/**
 * Facture (Prompt 148, conformité fiscale Maroc). Une ligne = un paiement
 * réussi (CMI ou Paddle/Lemon Squeezy) devenu une facture conforme :
 *  - Champs fiscaux marocains optionnels (ICE, IF) renseignés dans les
 *    réglages de facturation de l'utilisateur (settings/billing) — absents
 *    si l'utilisateur est hors Maroc ou n'a pas encore renseigné son statut.
 *  - `taxStatus` distingue auto-entrepreneur (taux et mentions légales
 *    différents : franchise de TVA, exonération) de société (TVA 20% + ICE/IF
 *    obligatoires sur la facture).
 *  - Le PDF (gabarit `invoice.html`, packages/design/pdf-templates) est
 *    archivé sous `pdfKey` (stockage objet), régénérable à l'identique.
 *
 * Synergie SallyFiscal (autre projet SALISTAR, simulateur fiscal Maroc+France) :
 * ce modèle Invoice pourrait à terme alimenter SallyFiscal en flux de revenus
 * réels (ICE, montants HT/TTC par période) pour affiner la simulation d'impôt
 * d'un auto-entrepreneur/société utilisant SallyCourse comme source de revenu.
 * Aucune intégration technique aujourd'hui — simple synergie documentée, les
 * deux projets restent indépendants (bases de données et déploiements séparés).
 */

/** Statut fiscal déclaré par l'utilisateur — pilote taux/mentions légales. */
export const TAX_STATUSES = ['auto_entrepreneur', 'company', 'unspecified'] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

/** Devise facturée (alignée sur PLAN_PRICING : MAD via CMI, EUR via Paddle/Lemon). */
export const INVOICE_CURRENCIES = ['MAD', 'EUR'] as const;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

/** Prestataire de paiement à l'origine de la facture (aligné PaymentProvider). */
export const INVOICE_PROVIDERS = ['cmi', 'paddle', 'lemonsqueezy', 'mock'] as const;
export type InvoiceProvider = (typeof INVOICE_PROVIDERS)[number];

export interface IInvoice {
  userId: Types.ObjectId;
  /** Numéro de facture unique et stable (SC-<YYYY>-<ref courte>). */
  invoiceNumber: string;
  plan: PlanId;
  /**
   * Identifiant Commun de l'Entreprise (Maroc) — obligatoire côté société,
   * optionnel/absent pour un auto-entrepreneur ou un client hors Maroc.
   */
  ice?: string;
  /** Identifiant Fiscal (Maroc) — même logique optionnelle que ICE. */
  if?: string;
  /** Statut fiscal déclaré au moment de l'émission (snapshot, ne change pas rétroactivement). */
  taxStatus: TaxStatus;
  /** Montant hors taxes, en plus petite unité (centimes). */
  amountHT: number;
  /** Taux de TVA appliqué (0.20 = 20%). 0 pour un auto-entrepreneur en franchise de TVA. */
  tva: number;
  /** Montant TVA, en plus petite unité (= round(amountHT * tva)). */
  amountTva: number;
  /** Montant TTC, en plus petite unité (= amountHT + amountTva). */
  amountTTC: number;
  currency: InvoiceCurrency;
  provider: InvoiceProvider;
  /** Référence opaque du paiement (oid CMI, subscription_id Paddle…) — traçabilité. */
  providerRef?: string;
  issuedAt: Date;
  /** Clé de stockage objet du PDF archivé (courses-like : invoices/{userId}/{invoiceNumber}.pdf). */
  pdfKey?: string;
  /** Locale de génération du PDF (fr par défaut, ar supporté — RTL). */
  locale: 'fr' | 'en' | 'ar';
  createdAt: Date;
  updatedAt: Date;
}

export type InvoiceDocument = HydratedDocument<IInvoice>;

const invoiceSchema = new Schema<IInvoice>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    plan: { type: String, enum: PLAN_IDS, required: true },
    ice: { type: String, trim: true },
    if: { type: String, trim: true },
    taxStatus: { type: String, enum: [...TAX_STATUSES], default: 'unspecified' },
    amountHT: { type: Number, required: true, min: 0 },
    tva: { type: Number, required: true, min: 0, max: 1, default: 0.2 },
    amountTva: { type: Number, required: true, min: 0 },
    amountTTC: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: [...INVOICE_CURRENCIES], required: true },
    provider: { type: String, enum: [...INVOICE_PROVIDERS], required: true },
    providerRef: { type: String, trim: true },
    issuedAt: { type: Date, required: true, default: Date.now },
    pdfKey: { type: String },
    locale: { type: String, enum: ['fr', 'en', 'ar'], default: 'fr' },
  },
  { timestamps: true },
);

// Historique de facturation d'un utilisateur, plus récent d'abord.
invoiceSchema.index({ userId: 1, issuedAt: -1 });
// Rapprochement paiement → facture (idempotence de génération).
invoiceSchema.index({ provider: 1, providerRef: 1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const Invoice: Model<IInvoice> =
  (models.Invoice as Model<IInvoice> | undefined) ?? model<IInvoice>('Invoice', invoiceSchema);
