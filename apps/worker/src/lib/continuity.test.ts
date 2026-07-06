// Tests de la cohérence inter-leçons (P19) : troncature du contexte de
// continuité (au plus ancien) et résumé mock (premières phrases du contenu).
import { describe, expect, it } from 'vitest';
import {
  CONTINUITY_MAX_CHARS,
  firstSentences,
  formatContinuityContext,
  type ContinuityEntry,
} from './continuity.js';

/** Fabrique n entrées ordonnées du plus ancien (0) au plus récent (n-1). */
function makeEntries(n: number, summaryLen = 40): ContinuityEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Leçon ${i}`,
    generatedSummary: `resume-${i}-`.padEnd(summaryLen, 'x'),
  }));
}

describe('formatContinuityContext', () => {
  it('retourne undefined sans entrée (première leçon du cours)', () => {
    expect(formatContinuityContext([])).toBeUndefined();
  });

  it('ignore les résumés vides ou blancs', () => {
    const ctx = formatContinuityContext([
      { title: 'Vide', generatedSummary: '   ' },
      { title: 'Absente', generatedSummary: '' },
    ]);
    expect(ctx).toBeUndefined();
  });

  it('concatène tous les résumés quand ils tiennent dans le budget', () => {
    const entries = makeEntries(3);
    const ctx = formatContinuityContext(entries);
    expect(ctx).toBeDefined();
    for (const e of entries) {
      expect(ctx).toContain(e.title);
      expect(ctx).toContain(e.generatedSummary);
    }
    // Consignes anti-répétition présentes en tête.
    expect(ctx).toContain('comme vu dans');
  });

  it('préserve l\'ordre chronologique (plus ancien → plus récent)', () => {
    const ctx = formatContinuityContext(makeEntries(3)) ?? '';
    const iL0 = ctx.indexOf('Leçon 0');
    const iL1 = ctx.indexOf('Leçon 1');
    const iL2 = ctx.indexOf('Leçon 2');
    expect(iL0).toBeLessThan(iL1);
    expect(iL1).toBeLessThan(iL2);
  });

  it('tronque au PLUS ANCIEN quand le budget est dépassé', () => {
    // 100 entrées de ~120 chars chacune ≈ 12000 chars, bien au-delà du budget.
    const entries = makeEntries(100, 100);
    const ctx = formatContinuityContext(entries) ?? '';

    // Le corps (hors consignes) tient sous le budget.
    expect(ctx.length).toBeLessThanOrEqual(CONTINUITY_MAX_CHARS + 400);

    // Les leçons LES PLUS RÉCENTES sont conservées, les plus anciennes coupées.
    expect(ctx).toContain('Leçon 99');
    expect(ctx).not.toContain('Leçon 0 ');
  });

  it('respecte une borne maxChars personnalisée', () => {
    const entries = makeEntries(50, 60);
    const small = formatContinuityContext(entries, 200) ?? '';
    const large = formatContinuityContext(entries, 4000) ?? '';
    // Un budget plus large conserve davantage d'entrées.
    const countSmall = (small.match(/^- /gm) ?? []).length;
    const countLarge = (large.match(/^- /gm) ?? []).length;
    expect(countLarge).toBeGreaterThan(countSmall);
  });

  it('garde au moins l\'entrée la plus récente même si elle dépasse à elle seule le budget', () => {
    const entries = makeEntries(3, 500); // chaque résumé ~500 chars
    const ctx = formatContinuityContext(entries, 50) ?? '';
    // Au moins une entrée (la plus récente) est présente malgré le budget minuscule.
    expect((ctx.match(/^- /gm) ?? []).length).toBe(1);
    expect(ctx).toContain('Leçon 2');
  });
});

describe('firstSentences (résumé mock)', () => {
  it('garde au plus 3 phrases', () => {
    const text = 'Phrase une. Phrase deux. Phrase trois. Phrase quatre. Phrase cinq.';
    const out = firstSentences(text);
    expect(out).toContain('Phrase une.');
    expect(out).toContain('Phrase trois.');
    expect(out).not.toContain('Phrase quatre.');
  });

  it('normalise les espaces et gère l\'absence de ponctuation', () => {
    expect(firstSentences('  un   texte\nsans   ponctuation  ')).toBe('un texte sans ponctuation');
  });

  it('borne la longueur avec une ellipse', () => {
    const long = `${'a'.repeat(400)}.`;
    const out = firstSentences(long, 3, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('retourne une chaîne vide sur entrée vide', () => {
    expect(firstSentences('   ')).toBe('');
  });
});
