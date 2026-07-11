import { randomBytes } from 'node:crypto';

/**
 * Coupons et promotions (Prompt 139) : logique PURE (aucune I/O) — validité
 * (dates, usage max), calcul du prix remisé et génération de code. La
 * décrémentation atomique réelle (findOneAndUpdate) vit côté appelant
 * (route API / worker), mais sa condition (filtre Mongo) est dérivée ici pour
 * rester testable sans connexion base.
 */

/** Alphabet lisible (sans caractères ambigus) pour les codes générés automatiquement. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Sous-ensemble minimal d'un coupon nécessaire à la validation pure (évite le couplage au document Mongoose). */
export interface CouponLike {
  validFrom: Date;
  validUntil: Date;
  maxUses?: number;
  usedCount: number;
  discountPercent?: number;
  discountAmount?: number;
}

export type CouponInvalidReason =
  | 'not_started'
  | 'expired'
  | 'max_uses_reached'
  | 'invalid_discount_shape';

export interface CouponValidityResult {
  valid: boolean;
  reason?: CouponInvalidReason;
}

/** Message utilisateur associé à chaque motif d'invalidité (FR, affichable tel quel). */
export const COUPON_INVALID_MESSAGES: Record<CouponInvalidReason, string> = {
  not_started: 'Ce code promo n’est pas encore actif.',
  expired: 'Ce code promo a expiré.',
  max_uses_reached: 'Ce code promo a atteint son nombre maximal d’utilisations.',
  invalid_discount_shape: 'Ce code promo est mal configuré (remise invalide).',
};

/**
 * Un coupon doit porter EXACTEMENT une remise : pourcentage (1-100) OU montant
 * fixe (>0), jamais les deux, jamais aucune.
 */
export function hasValidDiscountShape(coupon: Pick<CouponLike, 'discountPercent' | 'discountAmount'>): boolean {
  const hasPercent = typeof coupon.discountPercent === 'number' && coupon.discountPercent > 0;
  const hasAmount = typeof coupon.discountAmount === 'number' && coupon.discountAmount > 0;
  return hasPercent !== hasAmount; // XOR : l'un ou l'autre, jamais les deux/aucun
}

/**
 * Valide un coupon à un instant `now` donné : fenêtre de dates, quota d'usage,
 * forme de la remise. Ne vérifie PAS l'existence/l'appartenance (fait par
 * l'appelant, avant l'appel — cette fonction est purement temporelle/quota).
 */
export function checkCouponValidity(coupon: CouponLike, now: Date = new Date()): CouponValidityResult {
  if (!hasValidDiscountShape(coupon)) return { valid: false, reason: 'invalid_discount_shape' };
  if (now < coupon.validFrom) return { valid: false, reason: 'not_started' };
  if (now > coupon.validUntil) return { valid: false, reason: 'expired' };
  if (typeof coupon.maxUses === 'number' && coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: 'max_uses_reached' };
  }
  return { valid: true };
}

/**
 * Filtre Mongo pour la décrémentation atomique (findOneAndUpdate) : ne
 * matche que si le coupon est encore utilisable à `now`, empêchant toute
 * race condition (deux checkouts simultanés ne peuvent pas dépasser maxUses).
 * `maxUses` absent/0 → illimité, donc pas de contrainte sur usedCount.
 */
export function atomicRedemptionFilter(
  code: string,
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    code: code.trim().toUpperCase(),
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    $or: [{ maxUses: { $exists: false } }, { maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }],
  };
}

/**
 * Applique la remise d'un coupon à un prix (centimes). Résultat borné à 0
 * (jamais négatif) — pourcentage arrondi à l'entier le plus proche.
 */
export function applyDiscount(priceCents: number, coupon: Pick<CouponLike, 'discountPercent' | 'discountAmount'>): number {
  if (priceCents <= 0) return 0;
  if (typeof coupon.discountPercent === 'number' && coupon.discountPercent > 0) {
    const discounted = priceCents - Math.round((priceCents * coupon.discountPercent) / 100);
    return Math.max(0, discounted);
  }
  if (typeof coupon.discountAmount === 'number' && coupon.discountAmount > 0) {
    return Math.max(0, priceCents - Math.round(coupon.discountAmount));
  }
  return priceCents;
}

/** Génère un code promo aléatoire lisible (8 caractères, alphabet restreint). Non déterministe. */
export function generateCouponCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

/** Vrai si la chaîne a la forme d'un code promo valide (générés par generateCouponCode ou saisis à la main). */
export function isValidCouponCodeShape(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v.length >= 3 && v.length <= 32 && /^[A-Z0-9-]+$/.test(v);
}

/**
 * Génère un code unique en interrogeant `exists` (typiquement un lookup DB) ;
 * borne le nombre d'essais pour éviter une boucle infinie en cas d'anomalie.
 */
export async function generateUniqueCouponCode(
  exists: (code: string) => Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateCouponCode();
    if (!(await exists(code))) return code;
  }
  throw new Error('Impossible de générer un code promo unique après plusieurs essais.');
}

/* ------------------------------------------------------------------ */
/* Calendrier promotionnel suggéré (période + pourcentage recommandé)   */
/* ------------------------------------------------------------------ */

/** Schéma attendu de la suggestion LLM (voir @sallycourse/worker generators/promo-calendar.ts). */
export interface PromoPeriodSuggestion {
  /** Nom de la période (ex. "Rentrée", "Black Friday"). */
  name: string;
  /** Date de début suggérée (ISO, YYYY-MM-DD). */
  startDate: string;
  /** Date de fin suggérée (ISO, YYYY-MM-DD). */
  endDate: string;
  /** Pourcentage de remise recommandé (1-100). */
  discountPercent: number;
  /** Justification courte (FR). */
  rationale: string;
}

/** Périodes promotionnelles génériques (repli déterministe hors LLM — mode mock/dégradé). */
export const GENERIC_PROMO_PERIODS: ReadonlyArray<Omit<PromoPeriodSuggestion, 'rationale'> & { rationale: string }> = [
  {
    name: 'Rentrée',
    startDate: '--09-01',
    endDate: '--09-15',
    discountPercent: 30,
    rationale: 'Pic de reprise des formations en septembre — forte intention d’achat.',
  },
  {
    name: 'Black Friday',
    startDate: '--11-24',
    endDate: '--11-30',
    discountPercent: 50,
    rationale: 'Semaine à plus fort volume de ventes de l’année sur les plateformes de cours en ligne.',
  },
  {
    name: 'Nouvel An',
    startDate: '--01-01',
    endDate: '--01-15',
    discountPercent: 40,
    rationale: 'Résolutions de début d’année — forte demande en formation personnelle/professionnelle.',
  },
];

/**
 * Complète les dates génériques (--MM-DD) en dates ISO complètes pour une
 * année cible donnée. Utilisé pour transformer GENERIC_PROMO_PERIODS (repli
 * mock) en suggestions concrètes exploitables telles quelles.
 */
export function resolveGenericPromoPeriods(year: number): PromoPeriodSuggestion[] {
  return GENERIC_PROMO_PERIODS.map((p) => ({
    ...p,
    startDate: `${year}${p.startDate}`,
    endDate: `${year}${p.endDate}`,
  }));
}
