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
