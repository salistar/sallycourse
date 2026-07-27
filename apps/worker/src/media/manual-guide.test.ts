// Tests des helpers PURS du pack « guide manuel » (Prompt 176) : descripteur de
// format par plateforme, blocs copier-coller, étapes rédigées, checklist,
// README/inventaire et document HTML autonome (interactif + variante impression).
import { describe, expect, it } from 'vitest';
import {
  buildChecklistItems,
  buildCopyBlocks,
  buildGuideHtml,
  buildReadme,
  buildResumeSteps,
  buildUploadSteps,
  buildVideoInventory,
  manualGuidePackFileName,
  manualPlatformFormat,
  type ManualGuideInput,
} from './manual-guide.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const baseInput: ManualGuideInput = {
  platform: 'udemy',
  courseTitle: 'Créer une API REST',
  courseId: 'course-abc',
  locale: 'fr',
  sections: [
    {
      order: 0,
      title: 'Introduction',
      quizCsvFile: '01-introduction.csv',
      lessons: [
        { order: 0, title: 'Bienvenue', type: 'video', durationMin: 5, videoRef: '01-introduction/01-bienvenue.mp4' },
        { order: 1, title: 'Concepts', type: 'article', articleFile: '02-concepts.html' },
      ],
    },
    {
      order: 1,
      title: 'Aller plus loin',
      lessons: [{ order: 0, title: 'Sécurité', type: 'video', videoRef: '02-aller-plus-loin/01-securite.mp4' }],
    },
  ],
  marketing: {
    subtitle: 'De zéro à la production',
    description: 'Un cours complet.',
    udemyDescription: 'Description SEO optimisée.',
    welcomeMessage: 'Bienvenue !',
    congratsMessage: 'Félicitations !',
    promoText: 'Rejoignez-nous.',
    learningObjectives: ['Comprendre REST', 'Sécuriser une API'],
    titleIdeas: ['API REST pro', 'Maîtriser REST'],
  },
};

/* ------------------------------------------------------------------ */
/* Descripteur de format                                              */
/* ------------------------------------------------------------------ */

describe('manualPlatformFormat', () => {
  it('Udemy → format natif CSV bulk quiz', () => {
    const fmt = manualPlatformFormat('udemy');
    expect(fmt.hasNativeQuizCsv).toBe(true);
    expect(fmt.label).toBe('Udemy');
    expect(fmt.importFormatName).toMatch(/CSV/i);
  });

  it('insensible à la casse', () => {
    expect(manualPlatformFormat('UDEMY').platform).toBe('udemy');
  });

  it('Teachable/Thinkific/interne → format générique (pas de CSV natif)', () => {
    expect(manualPlatformFormat('teachable').hasNativeQuizCsv).toBe(false);
    expect(manualPlatformFormat('thinkific').hasNativeQuizCsv).toBe(false);
    expect(manualPlatformFormat('internal').hasNativeQuizCsv).toBe(false);
  });

  it('plateforme inconnue → repli lisible, générique', () => {
    const fmt = manualPlatformFormat('podia');
    expect(fmt.hasNativeQuizCsv).toBe(false);
    expect(fmt.label).toBe('Podia');
  });
});

/* ------------------------------------------------------------------ */
/* Blocs copier-coller                                                */
/* ------------------------------------------------------------------ */

describe('buildCopyBlocks', () => {
  it('inclut titre + blocs marketing renseignés', () => {
    const blocks = buildCopyBlocks(baseInput);
    const ids = blocks.map((b) => b.id);
    expect(ids).toContain('titre');
    expect(ids).toContain('description-udemy');
    expect(ids).toContain('message-bienvenue');
    expect(ids).toContain('objectifs');
    expect(ids).toContain('idees-titres');
    expect(blocks.find((b) => b.id === 'titre')?.text).toBe('Créer une API REST');
  });

  it('objectifs et idées de titres formatés en liste à tirets', () => {
    const blocks = buildCopyBlocks(baseInput);
    expect(blocks.find((b) => b.id === 'objectifs')?.text).toBe('- Comprendre REST\n- Sécuriser une API');
    expect(blocks.find((b) => b.id === 'idees-titres')?.text).toBe('- API REST pro\n- Maîtriser REST');
  });

  it('ignore les blocs vides / absents', () => {
    const blocks = buildCopyBlocks({ ...baseInput, marketing: {} });
    const ids = blocks.map((b) => b.id);
    expect(ids).toEqual(['titre']);
  });
});

/* ------------------------------------------------------------------ */
/* Étapes d'upload                                                    */
/* ------------------------------------------------------------------ */

describe('buildUploadSteps', () => {
  it('Udemy mentionne l’import CSV natif des quiz', () => {
    const steps = buildUploadSteps(baseInput).join('\n');
    expect(steps).toMatch(/Importer des questions/i);
    expect(steps).toMatch(/CSV/i);
    expect(steps).toMatch(/contenu généré par IA/i);
  });

  it('plateforme générique → recréation manuelle des quiz, pas d’import CSV', () => {
    const steps = buildUploadSteps({ ...baseInput, platform: 'teachable' }).join('\n');
    expect(steps).toMatch(/recréez les questions manuellement/i);
    expect(steps).not.toMatch(/Importer des questions/i);
  });
});

/* ------------------------------------------------------------------ */
/* Checklist                                                          */
/* ------------------------------------------------------------------ */

describe('buildChecklistItems', () => {
  it('une entrée par section + mention IA + revue pour Udemy', () => {
    const items = buildChecklistItems(baseInput);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('section-0');
    expect(ids).toContain('section-1');
    expect(ids).toContain('mention-ia');
    expect(ids).toContain('revue');
    expect(items.find((i) => i.id === 'section-0')?.label).toMatch(/Introduction/);
  });

  it('plateforme générique → étape « publier » au lieu de la revue Udemy', () => {
    const ids = buildChecklistItems({ ...baseInput, platform: 'thinkific' }).map((i) => i.id);
    expect(ids).toContain('publier');
    expect(ids).not.toContain('mention-ia');
  });
});

/* ------------------------------------------------------------------ */
/* Document HTML                                                      */
/* ------------------------------------------------------------------ */

describe('buildGuideHtml', () => {
  it('document autonome (doctype, head, body, style inline)', () => {
    const html = buildGuideHtml(baseInput);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<style>');
    expect(html).toContain('Guide d’upload manuel');
    expect(html).toContain('Créer une API REST');
  });

  it('mode interactif : boutons Copier + checkbox actives + script', () => {
    const html = buildGuideHtml(baseInput, { interactive: true });
    expect(html).toContain('class="copy-btn"');
    expect(html).toContain('data-item-id=');
    expect(html).toContain('<script>');
    expect(html).not.toContain('disabled aria-hidden');
  });

  it('variante impression (PDF) : aucun script ni bouton, cases désactivées', () => {
    const html = buildGuideHtml(baseInput, { interactive: false });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('class="copy-btn"');
    expect(html).toContain('disabled aria-hidden');
  });

  it('bannière assumant l’absence de captures du back-office', () => {
    const html = buildGuideHtml(baseInput);
    expect(html).toMatch(/Pas de captures/i);
  });

  it('échappe le contenu injecté (anti-XSS)', () => {
    const html = buildGuideHtml({
      ...baseInput,
      courseTitle: '<script>alert(1)</script>',
      marketing: { promoText: '<img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror');
  });

  it('liste la structure : leçons, réfs vidéo et fichiers d’articles/quiz', () => {
    const html = buildGuideHtml(baseInput);
    expect(html).toContain('01-introduction/01-bienvenue.mp4');
    expect(html).toContain('content/articles/02-concepts.html');
    expect(html).toContain('content/quiz/01-introduction.csv');
  });
});

/* ------------------------------------------------------------------ */
/* README / inventaire / nom de fichier                              */
/* ------------------------------------------------------------------ */

describe('buildReadme & buildVideoInventory', () => {
  it('README décrit le contenu et la limite (vidéos + captures)', () => {
    const readme = buildReadme(baseInput);
    expect(readme).toMatch(/guide\.html/);
    expect(readme).toMatch(/guide\.pdf/);
    expect(readme).toMatch(/course-pack\.zip/);
    expect(readme).toMatch(/captures/i);
  });

  it('inventaire liste les vidéos par section avec leur réf de fichier', () => {
    const inv = buildVideoInventory(baseInput);
    expect(inv).toContain('Bienvenue');
    expect(inv).toContain('01-introduction/01-bienvenue.mp4');
    expect(inv).toContain('02-aller-plus-loin/01-securite.mp4');
  });
});

describe('manualGuidePackFileName', () => {
  it('nom de fichier sûr par plateforme', () => {
    expect(manualGuidePackFileName('udemy')).toBe('course-manual-guide-udemy.zip');
    expect(manualGuidePackFileName('Teachable')).toBe('course-manual-guide-teachable.zip');
  });

  it('guide de reprise (P179) : suffixe -resume distinct du guide complet', () => {
    expect(manualGuidePackFileName('udemy', true)).toBe('course-manual-guide-udemy-resume.zip');
  });
});

/* ------------------------------------------------------------------ */
/* Reprise (Prompt 179) : guide des étapes RESTANTES                    */
/* ------------------------------------------------------------------ */

describe('buildResumeSteps', () => {
  it('null hors mode reprise', () => {
    expect(buildResumeSteps(baseInput)).toBeNull();
  });

  it('sépare le déjà-fait (auth + createCourse + leçons uploadées) des étapes restantes', () => {
    // baseInput = 3 leçons ; checkpoint upload lessonIndex=2 ⇒ 2 leçons faites.
    const resume = buildResumeSteps({
      ...baseInput,
      resume: { checkpoint: { lessonIndex: 2, step: 'upload' } },
    });
    expect(resume).not.toBeNull();
    expect(resume!.done.map((s) => s.key)).toEqual([
      'authenticate',
      'createCourse',
      'upload-0',
      'upload-1',
    ]);
    expect(resume!.pending.map((s) => s.key)).toEqual(['upload-2', 'landing', 'review']);
  });

  it('checkpoint vide ⇒ toutes les étapes restantes (dégradation propre)', () => {
    const resume = buildResumeSteps({
      ...baseInput,
      resume: { checkpoint: { lessonIndex: 0, step: '' } },
    });
    expect(resume!.done).toHaveLength(0);
    // auth + createCourse + 3 leçons + landing + review = 7 étapes, toutes restantes.
    expect(resume!.pending).toHaveLength(7);
  });
});

describe('buildGuideHtml (reprise)', () => {
  const resumeInput: ManualGuideInput = {
    ...baseInput,
    resume: { checkpoint: { lessonIndex: 2, step: 'upload' } },
  };

  it('affiche le bandeau de reprise et la section « étapes restantes »', () => {
    const html = buildGuideHtml(resumeInput, { interactive: true });
    expect(html).toContain('banner resume');
    expect(html).toMatch(/Reprise d’un déploiement interrompu/);
    expect(html).toContain('Étapes restantes');
    expect(html).toContain('Déjà réalisé automatiquement');
  });

  it('la checklist ne contient que les étapes restantes (clés de steps.ts)', () => {
    const html = buildGuideHtml(resumeInput, { interactive: true });
    // Étape restante attendue.
    expect(html).toContain('data-item-id="upload-2"');
    // Étape déjà faite : absente de la checklist cochable.
    expect(html).not.toContain('data-item-id="upload-0"');
  });

  it('guide complet (sans resume) conserve la checklist historique (P176)', () => {
    const html = buildGuideHtml(baseInput, { interactive: true });
    expect(html).not.toContain('banner resume');
    expect(html).toContain('Checklist d’avancement');
  });
});
