import { describe, expect, it } from 'vitest';
import {
  rowCostUsd,
  costByCourse,
  totalCostUsd,
  marginByPlan,
  alertingCourses,
  usageByCourse,
  compareCourseCost,
  costByProvider,
  usageTimeline,
  providerOfRow,
  type CostRow,
} from './cost-stats';
import {
  claudeCostUsd,
  ttsCostUsd,
  renderCostUsd,
  imageCostUsd,
  planMargin,
  EUR_TO_USD,
  computeOssCost,
  recommendProviderMix,
  DEFAULT_PROVIDER_MIX,
} from '@sallycourse/shared';

describe('rowCostUsd', () => {
  it('estime le coût Claude depuis les tokens et le modèle', () => {
    const row: CostRow = { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'claude-sonnet-5', tokensIn: 1_000_000, tokensOut: 1_000_000 };
    // 1M in × 3 + 1M out × 15 = 18 USD.
    expect(rowCostUsd(row)).toBeCloseTo(18, 6);
    expect(rowCostUsd(row)).toBeCloseTo(claudeCostUsd('claude-sonnet-5', 1_000_000, 1_000_000), 9);
  });

  it('retombe sur le modèle par défaut si le modèle est inconnu', () => {
    const row: CostRow = { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'modele-inexistant', tokensIn: 1_000_000, tokensOut: 0 };
    expect(rowCostUsd(row)).toBeCloseTo(3, 6); // 1M in × 3 (sonnet-5 fallback)
  });

  it('estime TTS aux caractères, render aux secondes, image forfaitaire', () => {
    expect(rowCostUsd({ courseId: 'c', userId: 'u', kind: 'tts', chars: 1000 })).toBeCloseTo(ttsCostUsd(1000), 9);
    expect(rowCostUsd({ courseId: 'c', userId: 'u', kind: 'render', seconds: 120 })).toBeCloseTo(renderCostUsd(120), 9);
    expect(rowCostUsd({ courseId: 'c', userId: 'u', kind: 'image' })).toBeCloseTo(imageCostUsd(1), 9);
  });

  it('traite les métriques manquantes comme 0', () => {
    expect(rowCostUsd({ courseId: 'c', userId: 'u', kind: 'tts' })).toBe(0);
    expect(rowCostUsd({ courseId: 'c', userId: 'u', kind: 'render' })).toBe(0);
  });
});

describe('costByCourse', () => {
  const rows: CostRow[] = [
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'claude-sonnet-5', tokensIn: 1_000_000, tokensOut: 0 }, // 3
    { courseId: 'c1', userId: 'u1', kind: 'tts', chars: 1000 }, // 0.22
    { courseId: 'c2', userId: 'u2', kind: 'render', seconds: 60 }, // petit
  ];

  it('agrège par cours et ventile par nature', () => {
    const result = costByCourse(rows);
    const c1 = result.find((c) => c.courseId === 'c1')!;
    expect(c1.byKind.claude).toBeCloseTo(3, 4);
    expect(c1.byKind.tts).toBeCloseTo(0.22, 4);
    expect(c1.totalUsd).toBeCloseTo(3.22, 4);
  });

  it('trie par coût décroissant (le plus cher en premier)', () => {
    const result = costByCourse(rows);
    expect(result[0]!.courseId).toBe('c1');
    expect(result[0]!.totalUsd).toBeGreaterThan(result[1]!.totalUsd);
  });

  it('signale les cours au-dessus du seuil', () => {
    // Seuil bas (0,1 USD) : c1 (3,22) dépasse, c2 (render 60 s) non.
    const result = costByCourse(rows, 0.1);
    const c1 = result.find((c) => c.courseId === 'c1')!;
    const c2 = result.find((c) => c.courseId === 'c2')!;
    expect(c1.overThreshold).toBe(true);
    expect(c2.overThreshold).toBe(false);
    expect(alertingCourses(result).map((c) => c.courseId)).toEqual(['c1']);
  });

  it('retourne un tableau vide pour aucune ligne', () => {
    expect(costByCourse([])).toEqual([]);
    expect(totalCostUsd([])).toBe(0);
  });
});

describe('marginByPlan', () => {
  it('calcule marge = revenu − coût, revenu = prix × utilisateurs', () => {
    // pro : 29 €/mois × 10 users = 290 € → USD ; coût 50 USD.
    const result = marginByPlan({ pro: 50 }, { pro: 10 });
    const pro = result.find((m) => m.plan === 'pro')!;
    const expected = planMargin('pro', 50, 10);
    expect(pro.revenueUsd).toBeCloseTo(round4(29 * 10 * EUR_TO_USD), 4);
    expect(pro.costUsd).toBe(50);
    expect(pro.marginUsd).toBeCloseTo(round4(expected.marginUsd), 4);
  });

  it('free : revenu nul → marge négative si coût > 0', () => {
    const result = marginByPlan({ free: 5 }, { free: 100 });
    const free = result.find((m) => m.plan === 'free')!;
    expect(free.revenueUsd).toBe(0);
    expect(free.marginUsd).toBeCloseTo(-5, 4);
  });

  it('trie par marge décroissante et couvre l’union des plans', () => {
    const result = marginByPlan({ pro: 10, free: 5 }, { pro: 5, business: 2 });
    expect(result.map((m) => m.plan)).toContain('business');
    expect(result.map((m) => m.plan)).toContain('free');
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.marginUsd).toBeGreaterThanOrEqual(result[i]!.marginUsd);
    }
  });
});

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ── Comparateur cloud vs OSS (Prompt 160) ───────────────────────────────

describe('usageByCourse', () => {
  const rows: CostRow[] = [
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'claude-sonnet-5', tokensIn: 1000, tokensOut: 500 },
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'claude-sonnet-5', tokensIn: 200, tokensOut: 100 },
    { courseId: 'c1', userId: 'u1', kind: 'tts', chars: 300 },
    { courseId: 'c1', userId: 'u1', kind: 'render', seconds: 45 },
    { courseId: 'c1', userId: 'u1', kind: 'image' },
    { courseId: 'c1', userId: 'u1', kind: 'image' },
    { courseId: 'c2', userId: 'u2', kind: 'tts', chars: 50 },
  ];

  it('additionne les métriques brutes par cours et par nature', () => {
    const usage = usageByCourse(rows);
    const c1 = usage.get('c1')!;
    expect(c1.tokensIn).toBe(1200);
    expect(c1.tokensOut).toBe(600);
    expect(c1.chars).toBe(300);
    expect(c1.renderSeconds).toBe(45);
    expect(c1.images).toBe(2);
  });

  it('un cours sans certaines natures reste à 0 sur ces métriques', () => {
    const usage = usageByCourse(rows);
    const c2 = usage.get('c2')!;
    expect(c2.tokensIn).toBe(0);
    expect(c2.images).toBe(0);
    expect(c2.chars).toBe(50);
  });

  it('aucune ligne → map vide', () => {
    expect(usageByCourse([]).size).toBe(0);
  });
});

describe('compareCourseCost', () => {
  const usage = { tokensIn: 1000, tokensOut: 1000, chars: 500, renderSeconds: 60, images: 1 };

  it('calcule cloud vs OSS pour le même usage, et recommande le mix (langue courante, plan free → full OSS)', () => {
    const result = compareCourseCost({
      courseId: 'c1',
      cloudTotalUsd: 5,
      usage,
      locale: 'fr',
      plan: 'free',
    });
    expect(result.cloudTotalUsd).toBe(5);
    const expectedOss = computeOssCost(usage);
    expect(result.ossTotalUsd).toBeCloseTo(round4(expectedOss.totalUsd), 4);
    expect(result.recommendedMix).toEqual(DEFAULT_PROVIDER_MIX);
  });

  it('OSS moins cher que cloud sur un usage réaliste', () => {
    const result = compareCourseCost({ courseId: 'c1', cloudTotalUsd: 10, usage, locale: 'fr', plan: 'pro' });
    expect(result.ossTotalUsd).toBeLessThan(result.cloudTotalUsd);
  });

  it('recommande cloud (llm) pour une langue rare, même si actualMix absent (défaut OSS)', () => {
    const result = compareCourseCost({ courseId: 'c1', cloudTotalUsd: 1, usage, locale: 'ar', plan: 'free' });
    expect(result.recommendedMix).toEqual(recommendProviderMix({ locale: 'ar', plan: 'free' }));
    expect(result.actualMix).toEqual(DEFAULT_PROVIDER_MIX);
  });

  it('reprend le mix réellement utilisé (actualMix) tel quel s’il est fourni', () => {
    const actualMix = { llm: 'cloud' as const, tts: 'oss' as const, image: 'cloud' as const };
    const result = compareCourseCost({ courseId: 'c1', cloudTotalUsd: 1, usage, locale: 'fr', plan: 'free', actualMix });
    expect(result.actualMix).toEqual(actualMix);
  });

  it('ventile le détail OSS par nature (llm/tts/render/image)', () => {
    const result = compareCourseCost({ courseId: 'c1', cloudTotalUsd: 1, usage, locale: 'fr', plan: 'free' });
    expect(result.ossBreakdown.llmUsd).toBeGreaterThan(0);
    expect(result.ossBreakdown.ttsUsd).toBeGreaterThan(0);
    expect(result.ossBreakdown.renderUsd).toBeGreaterThan(0);
    expect(result.ossBreakdown.imageUsd).toBeGreaterThan(0);
    expect(result.ossBreakdown.totalUsd).toBeCloseTo(
      result.ossBreakdown.llmUsd + result.ossBreakdown.ttsUsd + result.ossBreakdown.renderUsd + result.ossBreakdown.imageUsd,
      4,
    );
  });
});

describe('providerOfRow', () => {
  it('utilise le modèle comme provider pour la génération de texte', () => {
    expect(providerOfRow({ courseId: 'c', userId: 'u', kind: 'claude', model: 'gemini-flash-latest' })).toBe(
      'gemini-flash-latest',
    );
  });
  it('utilise le moteur TTS comme provider pour la voix', () => {
    expect(providerOfRow({ courseId: 'c', userId: 'u', kind: 'tts', model: 'modal' })).toBe('modal');
  });
  it('retombe sur ffmpeg pour le rendu', () => {
    expect(providerOfRow({ courseId: 'c', userId: 'u', kind: 'render' })).toBe('ffmpeg');
  });
});

describe('costByProvider', () => {
  const rows: CostRow[] = [
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'gemini-flash-latest', tokensIn: 1000, tokensOut: 500 },
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'gemini-flash-latest', tokensIn: 2000, tokensOut: 800 },
    { courseId: 'c1', userId: 'u1', kind: 'claude', model: 'deepseek-chat', tokensIn: 1000, tokensOut: 1000 },
    { courseId: 'c1', userId: 'u1', kind: 'tts', model: 'modal', chars: 500 },
    { courseId: 'c1', userId: 'u1', kind: 'tts', model: 'edge', chars: 500 },
  ];

  it('agrège les appels + coût par provider (modèle)', () => {
    const byProvider = costByProvider(rows);
    const gemini = byProvider.find((p) => p.provider === 'gemini-flash-latest');
    expect(gemini?.calls).toBe(2);
    expect(gemini?.totalUsd).toBe(0); // Gemini gratuit → 0
    expect(gemini?.tokensIn).toBe(3000);
  });

  it('compte les voix gratuites (edge) à 0 et Modal à un coût > 0', () => {
    const byProvider = costByProvider(rows);
    expect(byProvider.find((p) => p.provider === 'edge')?.totalUsd).toBe(0);
    expect(byProvider.find((p) => p.provider === 'modal')?.totalUsd).toBeGreaterThan(0);
  });

  it('trie par coût décroissant puis appels', () => {
    const byProvider = costByProvider(rows);
    for (let i = 1; i < byProvider.length; i += 1) {
      expect(byProvider[i - 1]!.totalUsd).toBeGreaterThanOrEqual(byProvider[i]!.totalUsd);
    }
  });
});

describe('usageTimeline', () => {
  it('produit une série continue de N jours se terminant à `today`', () => {
    const days = usageTimeline([], '2026-07-14', 30);
    expect(days).toHaveLength(30);
    expect(days[days.length - 1]!.date).toBe('2026-07-14');
    expect(days[0]!.date).toBe('2026-06-15');
    expect(days.every((d) => d.totalUsd === 0 && d.calls === 0)).toBe(true);
  });

  it('range chaque coût dans le bon jour et ignore les lignes hors fenêtre', () => {
    const rows: CostRow[] = [
      { courseId: 'c', userId: 'u', kind: 'tts', model: 'modal', chars: 1000, createdAt: '2026-07-14T09:00:00.000Z' },
      { courseId: 'c', userId: 'u', kind: 'tts', model: 'edge', chars: 1000, createdAt: '2026-07-13T09:00:00.000Z' },
      { courseId: 'c', userId: 'u', kind: 'tts', model: 'modal', chars: 1000, createdAt: '2020-01-01T00:00:00.000Z' },
    ];
    const days = usageTimeline(rows, '2026-07-14', 30);
    const today = days.find((d) => d.date === '2026-07-14')!;
    const yesterday = days.find((d) => d.date === '2026-07-13')!;
    expect(today.calls).toBe(1);
    expect(today.totalUsd).toBeGreaterThan(0);
    expect(yesterday.calls).toBe(1);
    expect(yesterday.byKind.tts).toBe(0); // edge gratuit
    // La ligne de 2020 est hors fenêtre → ignorée (total sur la période = today + edge(0)).
    const totalCalls = days.reduce((acc, d) => acc + d.calls, 0);
    expect(totalCalls).toBe(2);
  });
});
