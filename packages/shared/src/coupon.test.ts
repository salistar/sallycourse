// Tests purs (P139) : validité de coupon (dates, usage max), décrément
// atomique (filtre Mongo dérivé), calcul de remise. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  applyDiscount,
  atomicRedemptionFilter,
  checkCouponValidity,
  generateCouponCode,
  generateUniqueCouponCode,
  hasValidDiscountShape,
  isValidCouponCodeShape,
  resolveGenericPromoPeriods,
  type CouponLike,
} from './coupon';

const baseCoupon = (overrides: Partial<CouponLike> = {}): CouponLike => ({
  validFrom: new Date(2026, 0, 1),
  validUntil: new Date(2026, 11, 31),
  usedCount: 0,
  discountPercent: 20,
  ...overrides,
});

describe('hasValidDiscountShape', () => {
  it('accepte un pourcentage seul', () => {
    expect(hasValidDiscountShape({ discountPercent: 10 })).toBe(true);
  });

  it('accepte un montant seul', () => {
    expect(hasValidDiscountShape({ discountAmount: 500 })).toBe(true);
  });

  it('rejette les deux à la fois', () => {
    expect(hasValidDiscountShape({ discountPercent: 10, discountAmount: 500 })).toBe(false);
  });

  it('rejette l’absence des deux', () => {
    expect(hasValidDiscountShape({})).toBe(false);
  });

  it('rejette une valeur nulle/zéro', () => {
    expect(hasValidDiscountShape({ discountPercent: 0 })).toBe(false);
  });
});

describe('checkCouponValidity', () => {
  it('valide un coupon actif sans quota', () => {
    const now = new Date(2026, 5, 15);
    expect(checkCouponValidity(baseCoupon(), now)).toEqual({ valid: true });
  });

  it('rejette un coupon pas encore commencé', () => {
    const coupon = baseCoupon({ validFrom: new Date(2027, 0, 1) });
    const result = checkCouponValidity(coupon, new Date(2026, 5, 15));
    expect(result).toEqual({ valid: false, reason: 'not_started' });
  });

  it('rejette un coupon expiré', () => {
    const coupon = baseCoupon({ validUntil: new Date(2025, 11, 31) });
    const result = checkCouponValidity(coupon, new Date(2026, 5, 15));
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('accepte pile aux bornes (validFrom inclus, validUntil inclus)', () => {
    const coupon = baseCoupon({ validFrom: new Date(2026, 5, 15), validUntil: new Date(2026, 5, 15) });
    expect(checkCouponValidity(coupon, new Date(2026, 5, 15)).valid).toBe(true);
  });

  it('rejette un coupon ayant atteint son quota d’usage', () => {
    const coupon = baseCoupon({ maxUses: 5, usedCount: 5 });
    const result = checkCouponValidity(coupon, new Date(2026, 5, 15));
    expect(result).toEqual({ valid: false, reason: 'max_uses_reached' });
  });

  it('accepte un coupon sous son quota d’usage', () => {
    const coupon = baseCoupon({ maxUses: 5, usedCount: 4 });
    expect(checkCouponValidity(coupon, new Date(2026, 5, 15)).valid).toBe(true);
  });

  it('maxUses=0 signifie illimité', () => {
    const coupon = baseCoupon({ maxUses: 0, usedCount: 999 });
    expect(checkCouponValidity(coupon, new Date(2026, 5, 15)).valid).toBe(true);
  });

  it('rejette une remise mal formée avant même de checker les dates', () => {
    const coupon = baseCoupon({ discountPercent: undefined, discountAmount: undefined });
    expect(checkCouponValidity(coupon, new Date(2026, 5, 15))).toEqual({
      valid: false,
      reason: 'invalid_discount_shape',
    });
  });
});

describe('atomicRedemptionFilter', () => {
  it('normalise le code en majuscules et inclut la fenêtre de dates', () => {
    const now = new Date(2026, 5, 15);
    const filter = atomicRedemptionFilter('abc123', now);
    expect(filter.code).toBe('ABC123');
    expect(filter.validFrom).toEqual({ $lte: now });
    expect(filter.validUntil).toEqual({ $gte: now });
  });

  it('inclut la contrainte de quota via $expr', () => {
    const filter = atomicRedemptionFilter('CODE1') as { $or: unknown[] };
    expect(Array.isArray(filter.$or)).toBe(true);
    expect(filter.$or).toHaveLength(3);
  });
});

describe('applyDiscount', () => {
  it('applique un pourcentage', () => {
    expect(applyDiscount(10000, { discountPercent: 20 })).toBe(8000);
  });

  it('applique un montant fixe', () => {
    expect(applyDiscount(10000, { discountAmount: 1500 })).toBe(8500);
  });

  it('ne descend jamais sous zéro', () => {
    expect(applyDiscount(1000, { discountAmount: 5000 })).toBe(0);
  });

  it('arrondit le pourcentage à l’entier le plus proche', () => {
    expect(applyDiscount(999, { discountPercent: 33 })).toBe(999 - Math.round(999 * 0.33));
  });

  it('prix gratuit reste à zéro', () => {
    expect(applyDiscount(0, { discountPercent: 50 })).toBe(0);
  });
});

describe('generateCouponCode / isValidCouponCodeShape', () => {
  it('génère un code de forme valide', () => {
    const code = generateCouponCode();
    expect(isValidCouponCodeShape(code)).toBe(true);
    expect(code).toHaveLength(8);
  });

  it('rejette un code trop court ou avec caractères invalides', () => {
    expect(isValidCouponCodeShape('AB')).toBe(false);
    expect(isValidCouponCodeShape('CODE_INVALIDE!')).toBe(false);
  });
});

describe('generateUniqueCouponCode', () => {
  it('retourne le premier code non existant', async () => {
    const code = await generateUniqueCouponCode(async () => false);
    expect(isValidCouponCodeShape(code)).toBe(true);
  });

  it('réessaie tant que le code existe puis abandonne après maxAttempts', async () => {
    await expect(generateUniqueCouponCode(async () => true, 3)).rejects.toThrow();
  });
});

describe('resolveGenericPromoPeriods', () => {
  it('résout les dates génériques pour une année donnée', () => {
    const periods = resolveGenericPromoPeriods(2026);
    expect(periods.length).toBeGreaterThan(0);
    for (const p of periods) {
      expect(p.startDate.startsWith('2026-')).toBe(true);
      expect(p.endDate.startsWith('2026-')).toBe(true);
      expect(p.discountPercent).toBeGreaterThan(0);
    }
  });
});
