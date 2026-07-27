import { describe, expect, it } from 'vitest';
import { renderGenerationDirectives, normalizeContentRatio } from './generation-params';
import type { AdvancedParams } from './schemas/course';

describe('renderGenerationDirectives', () => {
  it('retourne une chaîne vide sans paramètres', () => {
    expect(renderGenerationDirectives(undefined, 'outline')).toBe('');
    expect(renderGenerationDirectives(null, 'content')).toBe('');
    expect(renderGenerationDirectives({}, 'outline')).toBe('');
  });

  it('injecte les consignes pédagogiques dans toutes les phases', () => {
    const p: AdvancedParams = { tone: 'energetic', density: 'detailed', approach: 'practice-first', analogies: true };
    const out = renderGenerationDirectives(p, 'article');
    expect(out).toContain('CONSIGNES AVANCÉES');
    expect(out).toContain('énergique');
    expect(out).toContain('très détaillée');
    expect(out).toContain('pratique');
    expect(out).toContain('analogies');
  });

  it('injecte le public cible et le domaine (mots-clés / exclusions / outils)', () => {
    const p: AdvancedParams = {
      audience: 'comptables marocains débutants',
      mandatoryKeywords: ['TVA', 'grand livre'],
      excludedTopics: ['cryptomonnaie'],
      imposedTools: 'Excel 365',
    };
    const out = renderGenerationDirectives(p, 'content');
    expect(out).toContain('comptables marocains débutants');
    expect(out).toContain('TVA, grand livre');
    expect(out).toContain('cryptomonnaie');
    expect(out).toContain('Excel 365');
  });

  it("n'inclut les consignes de STRUCTURE que dans la phase outline", () => {
    const p: AdvancedParams = {
      targetHours: 6,
      avgVideoLength: '5-8',
      quizPosition: 'per-section',
      finalExam: true,
      finalExamPassingScore: 70,
      projectMode: 'fil-rouge',
    };
    const outline = renderGenerationDirectives(p, 'outline');
    expect(outline).toContain('6 heures');
    expect(outline).toContain('5-8 minutes');
    expect(outline).toContain('chaque section');
    expect(outline).toContain('EXAMEN FINAL');
    expect(outline).toContain('70 %');
    expect(outline).toContain('FIL ROUGE');
    // En phase article, la structure ne doit PAS apparaître.
    const article = renderGenerationDirectives(p, 'article');
    expect(article).not.toContain('heures');
    expect(article).not.toContain('EXAMEN FINAL');
  });

  it('injecte OS et langue des commentaires uniquement pour TP/scripts', () => {
    const p: AdvancedParams = { tpOs: 'linux', codeCommentLang: 'anglais' };
    expect(renderGenerationDirectives(p, 'tp')).toContain('Linux');
    expect(renderGenerationDirectives(p, 'tp')).toContain('anglais');
    expect(renderGenerationDirectives(p, 'outline')).not.toContain('Linux');
    // tpOs='any' est ignoré.
    expect(renderGenerationDirectives({ tpOs: 'any' }, 'tp')).toBe('');
  });

  it('injecte la cible de certification', () => {
    expect(renderGenerationDirectives({ certificationTarget: 'ISTQB Foundation' }, 'outline')).toContain('ISTQB Foundation');
  });

  it('en phase script, ajoute la consigne de dialogue bi-voix (P169)', () => {
    const s = renderGenerationDirectives({ dialogueMode: true }, 'script');
    expect(s).toContain('DIALOGUE');
    expect(s).toContain('[Formateur]');
    expect(s).toContain('[Apprenant]');
    // pas de dialogue en phase outline/article
    expect(renderGenerationDirectives({ dialogueMode: true }, 'outline')).not.toContain('DIALOGUE');
  });

  it('en phase quiz, ajoute le format examen de certification (P168)', () => {
    const q = renderGenerationDirectives({ certificationTarget: 'AWS SAA' }, 'quiz');
    expect(q).toContain('examen de certification');
    expect(q).toContain('AWS SAA');
    expect(q).toContain('distracteurs');
    // en phase outline, cette consigne spécifique quiz n'apparaît pas
    expect(renderGenerationDirectives({ certificationTarget: 'AWS SAA' }, 'outline')).not.toContain('distracteurs');
  });
});

describe('normalizeContentRatio', () => {
  it('normalise à 100 %', () => {
    const r = normalizeContentRatio({ video: 40, article: 25, tp: 20, quiz: 15 });
    expect(r.video + r.article + r.tp + r.quiz).toBeGreaterThanOrEqual(99);
    expect(r.video).toBe(40);
  });

  it('gère des poids arbitraires', () => {
    const r = normalizeContentRatio({ video: 2, article: 1, tp: 1, quiz: 0 });
    expect(r.video).toBe(50);
    expect(r.quiz).toBe(0);
  });

  it('retombe sur un défaut équilibré si tout est nul ou absent', () => {
    expect(normalizeContentRatio({ video: 0, article: 0, tp: 0, quiz: 0 }).video).toBe(40);
    expect(normalizeContentRatio(undefined).article).toBe(25);
  });
});
