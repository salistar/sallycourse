import { describe, expect, it, vi } from 'vitest';

// Tests de la recherche de niche (P86) — mode MOCK exclusivement (aucun appel
// réseau réel) : calcul de score PUR + mock déterministe de la recherche.

vi.mock('@sallycourse/shared', async () => {
  const actual = await vi.importActual<typeof import('@sallycourse/shared')>('@sallycourse/shared');
  return { ...actual, getConfig: () => ({ MOCK_PROVIDERS: true }) };
});

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { computeNicheCandidate, rankNicheCandidates, findNicheOpportunities } = await import(
  './niche-research'
);

describe('computeNicheCandidate', () => {
  it('calcule un score de demande combinant popularité et boost externe (70/30)', () => {
    const candidate = computeNicheCandidate(
      { title: 'Sujet test', popularity: 80, saturation: 40, baseCourseCount: 100, baseRating: 4.5, basePrice: 49 },
      50,
    );
    // 80*0.7 + 50*0.3 = 56 + 15 = 71
    expect(candidate.demandScore).toBe(71);
  });

  it('calcule un score de concurrence combinant saturation et boost externe (85/15)', () => {
    const candidate = computeNicheCandidate(
      { title: 'Sujet test', popularity: 80, saturation: 40, baseCourseCount: 100, baseRating: 4.5, basePrice: 49 },
      50,
    );
    // 40*0.85 + 50*0.15 = 34 + 7.5 = 41.5 → arrondi 42
    expect(candidate.competitionScore).toBe(42);
  });

  it('sans boost externe, les scores dérivent uniquement de la graine', () => {
    const candidate = computeNicheCandidate({
      title: 'Sujet test',
      popularity: 60,
      saturation: 30,
      baseCourseCount: 50,
      baseRating: 4.2,
      basePrice: 39,
    });
    expect(candidate.demandScore).toBe(42); // 60*0.7
    expect(candidate.competitionScore).toBe(26); // round(30*0.85) = round(25.5) = 26
  });

  it('borne les scores dans [0, 100] même avec un boost hors bornes', () => {
    const candidate = computeNicheCandidate(
      { title: 'Sujet test', popularity: 100, saturation: 100, baseCourseCount: 1, baseRating: 5, basePrice: 10 },
      500,
    );
    expect(candidate.demandScore).toBeLessThanOrEqual(100);
    expect(candidate.competitionScore).toBeLessThanOrEqual(100);
  });

  it('reporte fidèlement les champs statiques de la graine', () => {
    const candidate = computeNicheCandidate({
      title: 'Excel avancé',
      popularity: 90,
      saturation: 80,
      baseCourseCount: 520,
      baseRating: 4.5,
      basePrice: 39,
    });
    expect(candidate.title).toBe('Excel avancé');
    expect(candidate.estimatedCourseCount).toBe(520);
    expect(candidate.avgRating).toBe(4.5);
    expect(candidate.avgPrice).toBe(39);
  });
});

describe('rankNicheCandidates', () => {
  it('trie par opportunité décroissante (demande - concurrence)', () => {
    const ranked = rankNicheCandidates([
      { title: 'B', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 60, competitionScore: 50 }, // opp 10
      { title: 'A', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 80, competitionScore: 20 }, // opp 60
      { title: 'C', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 40, competitionScore: 45 }, // opp -5
    ]);
    expect(ranked.map((c) => c.title)).toEqual(['A', 'B', 'C']);
  });

  it('départage à opportunité égale par demandScore décroissant', () => {
    const ranked = rankNicheCandidates([
      { title: 'Faible demande', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 30, competitionScore: 10 }, // opp 20
      { title: 'Forte demande', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 50, competitionScore: 30 }, // opp 20
    ]);
    expect(ranked[0]?.title).toBe('Forte demande');
  });

  it('départage enfin par ordre alphabétique du titre (stabilité déterministe)', () => {
    const ranked = rankNicheCandidates([
      { title: 'Zèbre', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 50, competitionScore: 30 },
      { title: 'Alpha', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 50, competitionScore: 30 },
    ]);
    expect(ranked.map((c) => c.title)).toEqual(['Alpha', 'Zèbre']);
  });

  it('ne mute pas le tableau reçu', () => {
    const input = [
      { title: 'A', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 10, competitionScore: 5 },
      { title: 'B', estimatedCourseCount: 1, avgRating: 4, avgPrice: 10, demandScore: 90, competitionScore: 5 },
    ];
    const originalOrder = input.map((c) => c.title);
    rankNicheCandidates(input);
    expect(input.map((c) => c.title)).toEqual(originalOrder);
  });
});

describe('findNicheOpportunities (mode mock forcé)', () => {
  it('retourne des candidats scorés pour chaque catégorie connue', async () => {
    for (const category of ['devops', 'office', 'languages', 'business'] as const) {
      const result = await findNicheOpportunities(category, { mockOnly: true });
      expect(result.category).toBe(category);
      expect(result.liveSignal).toBe(false);
      expect(result.candidates.length).toBeGreaterThan(0);
      for (const c of result.candidates) {
        expect(c.demandScore).toBeGreaterThanOrEqual(0);
        expect(c.competitionScore).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('est déterministe : deux appels identiques renvoient les mêmes candidats', async () => {
    const first = await findNicheOpportunities('office', { mockOnly: true });
    const second = await findNicheOpportunities('office', { mockOnly: true });
    expect(first.candidates).toEqual(second.candidates);
  });

  it('respecte MOCK_PROVIDERS (getConfig mocké à true) même sans mockOnly explicite', async () => {
    const result = await findNicheOpportunities('business');
    expect(result.liveSignal).toBe(false);
  });

  it('trie déjà les candidats retournés (le premier a l’opportunité la plus haute)', async () => {
    const result = await findNicheOpportunities('devops', { mockOnly: true });
    const opportunities = result.candidates.map((c) => c.demandScore - c.competitionScore);
    const sorted = [...opportunities].sort((a, b) => b - a);
    expect(opportunities).toEqual(sorted);
  });
});
