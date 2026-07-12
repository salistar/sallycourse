// Tests de la table de tarifs (Prompt 55) : coûts par provider + marge par plan.
import { describe, expect, it } from 'vitest';
import {
  claudeCostUsd,
  ttsCostUsd,
  renderCostUsd,
  imageCostUsd,
  planMargin,
  CLAUDE_PRICING_USD_PER_MTOK,
  TTS_USD_PER_CHAR,
  RENDER_USD_PER_SECOND,
  IMAGE_USD_PER_UNIT,
  PLAN_REVENUE_EUR_PER_MONTH,
  EUR_TO_USD,
  ossLlmCostUsd,
  ossTtsCostUsd,
  ossRenderCostUsd,
  ossImageCostUsd,
  computeOssCost,
  recommendProviderMix,
  HETZNER_USD_PER_HOUR,
  OSS_COMPUTE_SECONDS_PER_UNIT,
  DEFAULT_PROVIDER_MIX,
  RARE_LOCALES,
  paymentMethodCost,
  PAYMENT_METHOD_FEES,
} from './pricing-table';

describe('claudeCostUsd', () => {
  it('facture in/out au tarif du modèle (par million de tokens)', () => {
    const p = CLAUDE_PRICING_USD_PER_MTOK['claude-sonnet-5']!;
    // 500k in + 200k out
    const expected = (500_000 * p.input + 200_000 * p.output) / 1_000_000;
    expect(claudeCostUsd('claude-sonnet-5', 500_000, 200_000)).toBeCloseTo(expected, 9);
  });

  it('retombe sur le modèle par défaut si inconnu', () => {
    const fallback = CLAUDE_PRICING_USD_PER_MTOK['claude-sonnet-5']!;
    expect(claudeCostUsd('gpt-inexistant', 1_000_000, 0)).toBeCloseTo(fallback.input, 9);
  });

  it('coût nul pour 0 token', () => {
    expect(claudeCostUsd('claude-opus-4-8', 0, 0)).toBe(0);
  });
});

describe('coûts TTS / render / image', () => {
  it('TTS : linéaire au caractère', () => {
    expect(ttsCostUsd(1000)).toBeCloseTo(1000 * TTS_USD_PER_CHAR, 12);
    expect(ttsCostUsd(-5)).toBe(0); // borne basse
  });

  it('tue le mutant Math.max(0, x) → x : exactement 0 caractère/seconde/unité reste 0, pas négatif', () => {
    // Un mutant qui supprimerait le clamp Math.max(0, …) ne serait détecté par
    // aucun test négatif seul si l'entrée est déjà 0 : on fige explicitement 0.
    expect(ttsCostUsd(0)).toBe(0);
    expect(renderCostUsd(0)).toBe(0);
    expect(imageCostUsd(0)).toBe(0);
  });

  it('render : linéaire à la seconde', () => {
    expect(renderCostUsd(120)).toBeCloseTo(120 * RENDER_USD_PER_SECOND, 12);
    expect(renderCostUsd(-1)).toBe(0);
  });

  it('image : forfait par unité', () => {
    expect(imageCostUsd()).toBeCloseTo(IMAGE_USD_PER_UNIT, 12);
    expect(imageCostUsd(3)).toBeCloseTo(3 * IMAGE_USD_PER_UNIT, 12);
  });
});

describe('planMargin', () => {
  it('marge = revenu(USD) − coût ; revenu = prix€ × users × taux', () => {
    const cost = 40;
    const users = 10;
    const m = planMargin('pro', cost, users);
    const revenueUsd = PLAN_REVENUE_EUR_PER_MONTH['pro']! * users * EUR_TO_USD;
    expect(m.revenueUsd).toBeCloseTo(revenueUsd, 6);
    expect(m.costUsd).toBe(cost);
    expect(m.marginUsd).toBeCloseTo(revenueUsd - cost, 6);
  });

  it('free : revenu nul → marge négative si coût > 0', () => {
    const m = planMargin('free', 12, 100);
    expect(m.revenueUsd).toBe(0);
    expect(m.marginUsd).toBe(-12);
  });

  it('plan inconnu → revenu nul (défaut 0)', () => {
    const m = planMargin('mystere', 5, 3);
    expect(m.revenueUsd).toBe(0);
    expect(m.marginUsd).toBe(-5);
  });

  it('activeUsers négatif borné à 0', () => {
    const m = planMargin('business', 0, -4);
    expect(m.revenueUsd).toBe(0);
  });

  it('activeUsers exactement 0 (pas seulement négatif) : revenu nul', () => {
    // Tue un mutant Math.max(0, x) → x qui ne se révélerait qu'avec un input
    // strictement négatif : ici l'entrée est déjà 0.
    const m = planMargin('pro', 3, 0);
    expect(m.revenueUsd).toBe(0);
    expect(m.marginUsd).toBe(-3);
  });

  it('activeUsers = 1 (valeur par défaut) : revenu = tarif du plan × taux, sans multiplication implicite', () => {
    const m = planMargin('business', 10);
    const expectedRevenue = PLAN_REVENUE_EUR_PER_MONTH['business']! * EUR_TO_USD;
    expect(m.revenueUsd).toBeCloseTo(expectedRevenue, 6);
  });
});

// ── Mode « full OSS » (Prompt 160) ──────────────────────────────────────
const HETZNER_USD_PER_SECOND = HETZNER_USD_PER_HOUR / 3600;

describe('ossLlmCostUsd', () => {
  it('proportionnel aux tokens (in+out), via la durée de compute par 1000 tokens', () => {
    const seconds = (2000 / 1000) * OSS_COMPUTE_SECONDS_PER_UNIT.llmSecondsPer1000Tokens;
    expect(ossLlmCostUsd(1000, 1000)).toBeCloseTo(seconds * HETZNER_USD_PER_SECOND, 9);
  });

  it('coût nul pour 0 token, borné à 0 si négatif', () => {
    expect(ossLlmCostUsd(0, 0)).toBe(0);
    expect(ossLlmCostUsd(-500, -500)).toBe(0);
  });

  it('moins cher que le mode cloud pour un volume de tokens réaliste', () => {
    expect(ossLlmCostUsd(1_000_000, 1_000_000)).toBeLessThan(claudeCostUsd('claude-sonnet-5', 1_000_000, 1_000_000));
  });
});

describe('ossTtsCostUsd', () => {
  it('proportionnel aux caractères', () => {
    const seconds = 1000 * OSS_COMPUTE_SECONDS_PER_UNIT.ttsSecondsPerChar;
    expect(ossTtsCostUsd(1000)).toBeCloseTo(seconds * HETZNER_USD_PER_SECOND, 9);
  });

  it('coût nul pour 0 caractère, borné à 0 si négatif', () => {
    expect(ossTtsCostUsd(0)).toBe(0);
    expect(ossTtsCostUsd(-10)).toBe(0);
  });
});

describe('ossRenderCostUsd', () => {
  it('identique au coût render cloud (même compute local, pas de facturation externe)', () => {
    expect(ossRenderCostUsd(120)).toBeCloseTo(renderCostUsd(120), 12);
  });
});

describe('ossImageCostUsd', () => {
  it('forfait par image, proportionnel au nombre d’unités', () => {
    const seconds = OSS_COMPUTE_SECONDS_PER_UNIT.imageSecondsPerUnit;
    expect(ossImageCostUsd(1)).toBeCloseTo(seconds * HETZNER_USD_PER_SECOND, 9);
    expect(ossImageCostUsd(3)).toBeCloseTo(3 * seconds * HETZNER_USD_PER_SECOND, 9);
  });

  it('coût nul pour 0 image (valeur par défaut = 1, doit être explicite)', () => {
    expect(ossImageCostUsd(0)).toBe(0);
  });
});

describe('computeOssCost', () => {
  it('agrège llm/tts/render/image en un total, réutilisant les mêmes métriques que le mode cloud', () => {
    const usage = { tokensIn: 1000, tokensOut: 1000, chars: 500, renderSeconds: 60, images: 2 };
    const result = computeOssCost(usage);
    expect(result.llmUsd).toBeCloseTo(ossLlmCostUsd(1000, 1000), 9);
    expect(result.ttsUsd).toBeCloseTo(ossTtsCostUsd(500), 9);
    expect(result.renderUsd).toBeCloseTo(ossRenderCostUsd(60), 9);
    expect(result.imageUsd).toBeCloseTo(ossImageCostUsd(2), 9);
    expect(result.totalUsd).toBeCloseTo(
      result.llmUsd + result.ttsUsd + result.renderUsd + result.imageUsd,
      9,
    );
  });

  it('métriques absentes → traitées comme 0, total nul', () => {
    const result = computeOssCost({});
    expect(result.totalUsd).toBe(0);
  });
});

describe('recommendProviderMix', () => {
  it('langue rare (ex. ar) → llm cloud, tts/image OSS', () => {
    const mix = recommendProviderMix({ locale: 'ar', plan: 'pro' });
    expect(mix).toEqual({ llm: 'cloud', tts: 'oss', image: 'oss' });
    expect(RARE_LOCALES).toContain('ar');
  });

  it('plan business (qualité premium) → llm cloud, tts/image OSS, même en langue courante', () => {
    const mix = recommendProviderMix({ locale: 'fr', plan: 'business' });
    expect(mix).toEqual({ llm: 'cloud', tts: 'oss', image: 'oss' });
  });

  it('langue courante + plan non-business → full OSS', () => {
    expect(recommendProviderMix({ locale: 'fr', plan: 'free' })).toEqual(DEFAULT_PROVIDER_MIX);
    expect(recommendProviderMix({ locale: 'en', plan: 'pro' })).toEqual(DEFAULT_PROVIDER_MIX);
  });

  it('langue rare ET plan business : reste sur la même recommandation (pas de double cloud)', () => {
    const mix = recommendProviderMix({ locale: 'ar', plan: 'business' });
    expect(mix).toEqual({ llm: 'cloud', tts: 'oss', image: 'oss' });
  });
});

// ── Coût par méthode de paiement (Prompt 158) ──────────────────────────────
describe('paymentMethodCost', () => {
  it('CMI : proportionnel au montant, sans frais fixe', () => {
    const amountMinor = 29900; // 299,00 MAD
    const expected = amountMinor * PAYMENT_METHOD_FEES.cmi.feePercent;
    expect(paymentMethodCost('cmi', amountMinor)).toBeCloseTo(expected, 9);
  });

  it('Paddle : proportionnel + frais fixe, uniquement si le montant est en USD', () => {
    const amountMinor = 2900; // 29,00 EUR/USD en centimes
    const proportional = amountMinor * PAYMENT_METHOD_FEES.paddle.feePercent;

    // Devise non confirmée USD : le frais fixe n'est pas ajouté (évite de
    // mélanger un fixe USD avec un montant EUR sans taux de change).
    expect(paymentMethodCost('paddle', amountMinor)).toBeCloseTo(proportional, 9);

    // Devise confirmée USD : le frais fixe (converti en centimes) s'ajoute.
    const withFixed = proportional + PAYMENT_METHOD_FEES.paddle.feeFixedUsd * 100;
    expect(paymentMethodCost('paddle', amountMinor, { currencyIsUsd: true })).toBeCloseTo(withFixed, 9);
  });

  it('virement manuel : zéro commission (0% + 0 fixe) quelle que soit la devise', () => {
    expect(paymentMethodCost('manual', 99900)).toBe(0);
    expect(paymentMethodCost('manual', 99900, { currencyIsUsd: true })).toBe(0);
  });

  it('montant négatif borné à 0 (pas de coût négatif)', () => {
    expect(paymentMethodCost('cmi', -1000)).toBe(0);
    expect(paymentMethodCost('paddle', -1000, { currencyIsUsd: true })).toBeCloseTo(
      PAYMENT_METHOD_FEES.paddle.feeFixedUsd * 100,
      9,
    );
  });

  it('manual est bien la méthode la moins chère (zéro commission garanti)', () => {
    const amountMinor = 50000;
    expect(paymentMethodCost('manual', amountMinor)).toBeLessThan(paymentMethodCost('cmi', amountMinor));
    expect(paymentMethodCost('manual', amountMinor)).toBeLessThan(paymentMethodCost('paddle', amountMinor));
  });
});
