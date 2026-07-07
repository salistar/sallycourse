// Tests des règles PURES du mode compliance maximale Udemy (Prompt 48).
// Aucune I/O : on couvre intro vidéo, scan liens/promo, slides « texte seul »,
// flags de rendu, puis l'agrégation score/verdict.
import { describe, expect, it } from 'vitest';
// @ts-ignore TS6059 — source hors rootDir, typage intact (aligné sur le module testé)
import type { UdemyComplianceInput } from '../shared.js';
import {
  checkIntroVideo,
  checkRenderFlags,
  checkUdemyMaxCompliance,
  extractSlideDurations,
  extractSlideTexts,
  flattenIssues,
  INTRO_VIDEO,
  isTextOnlySlide,
  scanLessonText,
  scanSlideDurations,
  TEXT_ONLY_SLIDE_MAX_SEC,
  type MaxComplianceCode,
  type MaxComplianceInput,
  type SlideDurationInput,
} from './udemy-max-compliance.js';

// Input de base entièrement conforme (aligné sur udemy-compliance.test.ts de shared).
function baseCompliant(): UdemyComplianceInput {
  return {
    title: 'Apprendre Python pas a pas',
    subtitle: 'Un parcours progressif pour construire vos premiers projets Python.',
    description: Array.from({ length: 210 }, (_, i) => `mot${i}`).join(' '),
    learningObjectives: [
      'Comprendre les bases du langage',
      'Ecrire des scripts robustes',
      'Manipuler des fichiers et des API',
      'Construire un mini projet complet',
    ],
    totalVideoMinutes: 60,
    sectionsCount: 6,
    lessons: [{ type: 'video', durationMin: 8, hasVideo: true }],
    courseImage: { width: 750, height: 422 },
    locale: 'fr',
  };
}

function slide(overrides: Partial<SlideDurationInput> = {}): SlideDurationInput {
  return { title: 'Intro', template: 'content', hasVisual: false, seconds: 20, ...overrides };
}

// Entrée MAX intégralement conforme ; chaque test dérive par override.
function maxCompliant(overrides: Partial<MaxComplianceInput> = {}): MaxComplianceInput {
  return {
    base: baseCompliant(),
    introVideo: { present: true, durationSec: INTRO_VIDEO.TARGET_SEC },
    lessonTexts: [{ title: 'Les variables', text: 'Contenu pédagogique propre, sans lien.' }],
    slides: [slide()],
    watermarkEnabled: true,
    audioNormalized: true,
    ...overrides,
  };
}

function maxCodes(input: MaxComplianceInput): MaxComplianceCode[] {
  return checkUdemyMaxCompliance(input).maxIssues.map((i) => i.code);
}

describe('checkIntroVideo', () => {
  it('valide une intro ~60 s', () => {
    expect(checkIntroVideo({ present: true, durationSec: 60 })).toBeNull();
  });

  it('erreur si absente', () => {
    expect(checkIntroVideo(undefined)?.code).toBe('MAX_INTRO_VIDEO_MISSING');
    expect(checkIntroVideo({ present: false })?.code).toBe('MAX_INTRO_VIDEO_MISSING');
  });

  it('avertit si trop courte', () => {
    const issue = checkIntroVideo({ present: true, durationSec: INTRO_VIDEO.MIN_SEC - 10 });
    expect(issue?.code).toBe('MAX_INTRO_VIDEO_TOO_SHORT');
    expect(issue?.severity).toBe('warning');
  });

  it('avertit si trop longue', () => {
    const issue = checkIntroVideo({ present: true, durationSec: INTRO_VIDEO.MAX_SEC + 30 });
    expect(issue?.code).toBe('MAX_INTRO_VIDEO_TOO_LONG');
  });

  it('tolère une durée manquante quand présente (0 → pas de borne basse)', () => {
    expect(checkIntroVideo({ present: true })).toBeNull();
  });
});

describe('scanLessonText', () => {
  it('détecte une URL http', () => {
    const issues = scanLessonText({ title: 'A', text: 'Voir https://exemple.com pour plus.' }, 0);
    expect(issues.map((i) => i.code)).toContain('MAX_LESSON_CONTAINS_URL');
  });

  it('détecte un www. sans schéma', () => {
    const issues = scanLessonText({ title: 'A', text: 'Rendez-vous sur www.monsite.fr' }, 0);
    expect(issues.map((i) => i.code)).toContain('MAX_LESSON_CONTAINS_URL');
  });

  it('détecte le vocabulaire promo (code promo, abonnez-vous)', () => {
    expect(scanLessonText({ title: 'A', text: 'Utilisez ce code promo !' }, 0)[0]?.code).toBe(
      'MAX_LESSON_CONTAINS_PROMO',
    );
    expect(scanLessonText({ title: 'A', text: 'Abonnez-vous à ma chaîne' }, 0)[0]?.code).toBe(
      'MAX_LESSON_CONTAINS_PROMO',
    );
  });

  it('remonte URL et promo simultanément', () => {
    const issues = scanLessonText(
      { title: 'A', text: 'Promo sur https://x.io — suivez-moi !' },
      0,
    );
    expect(issues).toHaveLength(2);
  });

  it('ne signale rien sur un texte propre', () => {
    expect(scanLessonText({ title: 'A', text: 'Une leçon claire et sobre.' }, 0)).toEqual([]);
  });

  it('numérote la leçon à partir de 1 dans la localisation', () => {
    const issues = scanLessonText({ title: 'Titre', text: 'http://x.io' }, 2);
    expect(issues[0]?.location).toContain('leçon 3');
  });
});

describe('isTextOnlySlide / scanSlideDurations', () => {
  it('une slide code/diagram/comparison n’est jamais texte seul', () => {
    expect(isTextOnlySlide(slide({ template: 'code' }))).toBe(false);
    expect(isTextOnlySlide(slide({ template: 'diagram' }))).toBe(false);
    expect(isTextOnlySlide(slide({ template: 'comparison' }))).toBe(false);
  });

  it('une slide content sans visuel est texte seul', () => {
    expect(isTextOnlySlide(slide({ template: 'content', hasVisual: false }))).toBe(true);
  });

  it('un visuel attaché neutralise le « texte seul »', () => {
    expect(isTextOnlySlide(slide({ template: 'content', hasVisual: true }))).toBe(false);
  });

  it('signale une slide texte seul affichée > 45 s', () => {
    const issues = scanSlideDurations([slide({ seconds: TEXT_ONLY_SLIDE_MAX_SEC + 5 })]);
    expect(issues[0]?.code).toBe('MAX_SLIDE_TEXT_ONLY_TOO_LONG');
  });

  it('ne signale pas à exactement 45 s', () => {
    expect(scanSlideDurations([slide({ seconds: TEXT_ONLY_SLIDE_MAX_SEC })])).toEqual([]);
  });

  it('ne signale pas une slide longue mais visuelle', () => {
    expect(scanSlideDurations([slide({ template: 'code', seconds: 120 })])).toEqual([]);
  });
});

describe('checkRenderFlags', () => {
  it('avertit si watermark désactivé', () => {
    const codes = checkRenderFlags(maxCompliant({ watermarkEnabled: false })).map((i) => i.code);
    expect(codes).toContain('MAX_WATERMARK_DISABLED');
  });

  it('avertit si audio non normalisé', () => {
    const codes = checkRenderFlags(maxCompliant({ audioNormalized: false })).map((i) => i.code);
    expect(codes).toContain('MAX_AUDIO_NOT_NORMALIZED');
  });

  it('rien si les deux flags sont bons', () => {
    expect(checkRenderFlags(maxCompliant())).toEqual([]);
  });
});

describe('checkUdemyMaxCompliance (agrégation)', () => {
  it('cas nominal : aucune remarque MAX, passed=true, score=base', () => {
    const report = checkUdemyMaxCompliance(maxCompliant());
    expect(report.maxIssues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(report.base.score);
    expect(report.base.score).toBe(100);
  });

  it('intro manquante → erreur bloquante, passed=false', () => {
    const report = checkUdemyMaxCompliance(maxCompliant({ introVideo: { present: false } }));
    expect(report.passed).toBe(false);
    expect(maxCodes(maxCompliant({ introVideo: { present: false } }))).toContain(
      'MAX_INTRO_VIDEO_MISSING',
    );
  });

  it('applique le barème -15/erreur et -5/avertissement au score de base', () => {
    // 1 erreur (URL) + 1 avertissement (watermark) = -20 sous 100.
    const report = checkUdemyMaxCompliance(
      maxCompliant({
        lessonTexts: [{ title: 'L', text: 'https://x.io' }],
        watermarkEnabled: false,
      }),
    );
    expect(report.score).toBe(80);
    expect(report.passed).toBe(false); // l'URL est bloquante
  });

  it('les avertissements seuls n’empêchent pas la validation', () => {
    const report = checkUdemyMaxCompliance(
      maxCompliant({ watermarkEnabled: false, audioNormalized: false }),
    );
    expect(report.passed).toBe(true);
    expect(report.score).toBe(90);
  });

  it('un échec du contrôle de base fait échouer le verdict combiné', () => {
    const base = baseCompliant();
    base.title = 'x'.repeat(80); // TITLE_TOO_LONG (erreur de base)
    expect(checkUdemyMaxCompliance(maxCompliant({ base })).passed).toBe(false);
  });

  it('flattenIssues concatène base puis MAX', () => {
    const report = checkUdemyMaxCompliance(maxCompliant({ introVideo: { present: false } }));
    const flat = flattenIssues(report);
    expect(flat.length).toBe(report.base.issues.length + report.maxIssues.length);
  });

  it('extractSlideTexts ne garde que les narrations non vides', () => {
    const script = {
      slides: [
        { narration: 'Bonjour' },
        { narration: '' },
        { title: 'sans narration' },
        null,
        { narration: 'Suite' },
      ],
    };
    expect(extractSlideTexts(script)).toEqual(['Bonjour', 'Suite']);
    expect(extractSlideTexts(null)).toEqual([]);
    expect(extractSlideTexts({ slides: 'x' })).toEqual([]);
  });

  it('extractSlideDurations ignore les slides sans durée et détecte les visuels', () => {
    const script = {
      slides: [
        { template: 'content', audioSeconds: 50, title: 'A' },
        { template: 'code', code: 'x=1', audioSeconds: 90, title: 'B' },
        { template: 'content', title: 'sans durée' },
      ],
    };
    const durations = extractSlideDurations(script);
    expect(durations).toHaveLength(2);
    expect(durations[0]).toMatchObject({ template: 'content', hasVisual: false, seconds: 50 });
    expect(durations[1]).toMatchObject({ template: 'code', hasVisual: true, seconds: 90 });
    // Chaîne complète : la slide content longue déclenche la remarque, pas la slide code.
    expect(scanSlideDurations(durations).map((i) => i.code)).toEqual([
      'MAX_SLIDE_TEXT_ONLY_TOO_LONG',
    ]);
  });

  it('plancher de score à 0', () => {
    const base = baseCompliant();
    base.title = ''; // plusieurs erreurs de base
    const report = checkUdemyMaxCompliance(
      maxCompliant({
        base,
        introVideo: { present: false },
        lessonTexts: [{ title: 'L', text: 'https://x.io code promo suivez-moi' }],
      }),
    );
    expect(report.score).toBeGreaterThanOrEqual(0);
  });
});
