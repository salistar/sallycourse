// Tests du générateur de scripts vidéo (Prompt 15) : fixture mock conforme à
// slideScriptSchema, règles métier (title/recap, volume, formules interdites)
// et court-circuit MOCK_PROVIDERS via callClaudeJson.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUDIO, resetConfigCache, slideScriptSchema, type SlideScript } from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import {
  extractDurationMinFromPrompt,
  mockSlideScript,
} from '../lib/mock-fixtures.js';
import { videoScriptSystemPrompt, videoScriptUserPrompt } from '../prompts/video-script.js';
import { countNarrationWords, validateVideoScriptBusiness } from './video-script.js';

/** Environnement complet et valide pour getConfig, en mode mock (zéro appel réseau). */
function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MOCK_PROVIDERS: 'true',
    ...overrides,
  });
  resetConfigCache();
}

beforeEach(() => setTestEnv());
afterEach(() => resetConfigCache());

describe('mockSlideScript', () => {
  it('produit un script conforme à slideScriptSchema', () => {
    const script = mockSlideScript('Apprendre Docker de zéro', 6);
    expect(slideScriptSchema.safeParse(script).success).toBe(true);
  });

  it('commence par une slide "title" et termine par une slide "recap"', () => {
    const script = mockSlideScript('Maîtriser Git', 6);
    expect(script.slides[0]?.template).toBe('title');
    expect(script.slides[script.slides.length - 1]?.template).toBe('recap');
  });

  it('est déterministe : même titre et durée → même script', () => {
    expect(mockSlideScript('Python avancé', 8)).toEqual(mockSlideScript('Python avancé', 8));
  });

  it('cale le volume de narration sur durationMin × débit AUDIO', () => {
    for (const durationMin of [3, 6, 12]) {
      const script = mockSlideScript('Kubernetes en pratique', durationMin);
      const words = countNarrationWords(script);
      const target = durationMin * AUDIO.NARRATION_WORDS_PER_MINUTE;
      expect(words).toBeGreaterThanOrEqual(target * 0.5);
      expect(words).toBeLessThanOrEqual(target * 1.7);
    }
  });

  it('renseigne code + language sur les slides de template "code"', () => {
    // Durée longue → beaucoup de slides intermédiaires, dont statistiquement du code.
    const script = mockSlideScript('TypeScript de A à Z', 12);
    for (const slide of script.slides.filter((s) => s.template === 'code')) {
      expect(slide.code?.trim()).toBeTruthy();
      expect(slide.language?.trim()).toBeTruthy();
    }
  });

  it('passe les validations métier du générateur', () => {
    expect(validateVideoScriptBusiness(mockSlideScript('Rust pour les curieux', 6), 6)).toEqual([]);
  });
});

describe('validateVideoScriptBusiness', () => {
  const validScript = (): SlideScript => mockSlideScript('Sujet de test', 6);

  it('signale une première slide qui n’est pas "title"', () => {
    const script = validScript();
    const first = script.slides[0];
    if (first) first.template = 'content';
    const problems = validateVideoScriptBusiness(script, 6);
    expect(problems.some((p) => p.includes('"title"'))).toBe(true);
  });

  it('signale une dernière slide qui n’est pas "recap"', () => {
    const script = validScript();
    const last = script.slides[script.slides.length - 1];
    if (last) last.template = 'content';
    const problems = validateVideoScriptBusiness(script, 6);
    expect(problems.some((p) => p.includes('"recap"'))).toBe(true);
  });

  it('signale l’ouverture creuse « dans cette vidéo nous allons »', () => {
    const script = validScript();
    const first = script.slides[0];
    if (first) first.narration = `Dans cette vidéo nous allons tout voir. ${first.narration}`;
    const problems = validateVideoScriptBusiness(script, 6);
    expect(problems.some((p) => p.includes('formule creuse'))).toBe(true);
  });

  it('signale une slide "code" sans champ code', () => {
    const script = validScript();
    const middle = script.slides[1];
    if (middle) {
      middle.template = 'code';
      delete middle.code;
    }
    const problems = validateVideoScriptBusiness(script, 6);
    expect(problems.some((p) => p.includes('"code"'))).toBe(true);
  });

  it('signale une narration trop courte ou trop longue pour la durée cible', () => {
    const script = validScript();
    // Le volume de narration correspond à 6 min : très hors budget pour 60 ou 1 min.
    expect(validateVideoScriptBusiness(script, 60).some((p) => p.includes('trop court'))).toBe(true);
    expect(validateVideoScriptBusiness(script, 1).some((p) => p.includes('trop long'))).toBe(true);
  });
});

describe('prompts video-script + callClaudeJson en mode mock', () => {
  it('extractDurationMinFromPrompt lit la durée cible du prompt utilisateur', () => {
    const user = videoScriptUserPrompt({
      lessonTitle: 'Comprendre les closures',
      summary: 'Les closures en JavaScript.',
      durationMin: 7,
      courseTitle: 'JavaScript moderne',
      difficulty: 'intermediate',
      locale: 'fr',
    });
    expect(extractDurationMinFromPrompt(user)).toBe(7);
  });

  it('retourne une fixture conforme, calée sur la leçon demandée', async () => {
    const durationMin = 7;
    const script = await callClaudeJson({
      schema: slideScriptSchema,
      system: videoScriptSystemPrompt(),
      user: videoScriptUserPrompt({
        lessonTitle: 'Comprendre les closures',
        durationMin,
        courseTitle: 'JavaScript moderne',
        difficulty: 'intermediate',
        locale: 'fr',
      }),
    });
    expect(slideScriptSchema.safeParse(script).success).toBe(true);
    expect(script.slides[0]?.template).toBe('title');
    expect(script.slides[0]?.title).toContain('closures');
    expect(script.slides[script.slides.length - 1]?.template).toBe('recap');
    expect(validateVideoScriptBusiness(script, durationMin)).toEqual([]);
  });
});
