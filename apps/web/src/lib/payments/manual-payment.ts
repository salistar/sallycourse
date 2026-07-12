import type { ManualPaymentStatus } from '@sallycourse/db';
import { isPaidPlan, type PaidPlanId } from './plans';

/**
 * Paiement manuel (Prompt 158) : virement bancaire international à zéro
 * commission, alternative à Paddle, validé à la main par un admin (pas de
 * webhook prestataire — aucun rapprochement automatique possible). Logique
 * PURE (transition de statut + validation d'entrée) ; l'I/O (DB, storage,
 * activation du plan) reste dans les route handlers / server actions.
 */

/** Décision admin possible sur une demande en attente. */
export type ManualPaymentDecision = 'approve' | 'reject';

export interface ManualPaymentTransitionInput {
  currentStatus: ManualPaymentStatus;
  decision: ManualPaymentDecision;
}

export interface ManualPaymentTransitionResult {
  ok: boolean;
  /** Nouveau statut si la transition est acceptée, sinon le statut inchangé. */
  nextStatus: ManualPaymentStatus;
  reason: string;
}

/**
 * Applique une décision admin à une demande de paiement manuel. Seule une
 * demande `pending` peut être approuvée ou rejetée — une demande déjà traitée
 * (approved/rejected) est terminale, toute nouvelle décision est refusée
 * (évite un double-crédit ou une réactivation accidentelle du plan).
 */
export function transitionManualPayment(
  input: ManualPaymentTransitionInput,
): ManualPaymentTransitionResult {
  const { currentStatus, decision } = input;

  if (currentStatus !== 'pending') {
    return {
      ok: false,
      nextStatus: currentStatus,
      reason: `Demande déjà traitée (statut actuel : ${currentStatus}).`,
    };
  }

  const nextStatus: ManualPaymentStatus = decision === 'approve' ? 'approved' : 'rejected';
  return {
    ok: true,
    nextStatus,
    reason: decision === 'approve' ? 'Demande approuvée, plan à activer.' : 'Demande rejetée.',
  };
}

/** Devises acceptées pour une demande de paiement manuel. */
export const MANUAL_PAYMENT_CURRENCIES_ALLOWED = ['EUR', 'USD', 'MAD', 'GBP'] as const;
export type ManualPaymentCurrencyInput = (typeof MANUAL_PAYMENT_CURRENCIES_ALLOWED)[number];

export interface ManualPaymentRequestInput {
  plan: string;
  amountRequested: number;
  currency: string;
}

export interface ManualPaymentValidationResult {
  ok: boolean;
  reason: string;
  plan?: PaidPlanId;
  currency?: ManualPaymentCurrencyInput;
}

/**
 * Valide les champs soumis par l'utilisateur pour une demande de paiement
 * manuel : plan payant connu, montant positif, devise supportée. Ne vérifie
 * PAS que le montant correspond au tarif du plan — le virement est manuel et
 * peut légitimement différer (remise, arrondi bancaire) ; c'est à l'admin de
 * juger avant d'approuver.
 */
export function validateManualPaymentRequest(
  input: ManualPaymentRequestInput,
): ManualPaymentValidationResult {
  if (!isPaidPlan(input.plan)) {
    return { ok: false, reason: `Plan invalide ou non payant : ${input.plan}.` };
  }
  if (!Number.isFinite(input.amountRequested) || input.amountRequested <= 0) {
    return { ok: false, reason: 'Montant demandé invalide (doit être positif).' };
  }
  if (!MANUAL_PAYMENT_CURRENCIES_ALLOWED.includes(input.currency as ManualPaymentCurrencyInput)) {
    return { ok: false, reason: `Devise non supportée : ${input.currency}.` };
  }
  return {
    ok: true,
    reason: 'Demande valide.',
    plan: input.plan,
    currency: input.currency as ManualPaymentCurrencyInput,
  };
}
