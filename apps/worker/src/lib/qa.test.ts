// Tests des checks PURS du contrôle qualité (Prompt 26) : quiz, placeholders,
// nombre de sections, durée vidéo totale et parsing volumedetect. Les I/O
// (Mongo, storage, ffprobe) ne sont pas couverts ici — logique isolée uniquement.
import { describe, expect, it } from 'vitest';
import { QUIZ, UDEMY, type QuizQuestion } from '../shared.js';
import {
  checkArticlePlaceholders,
  checkIllustrationConsistency,
  checkQuizzes,
  checkSectionCount,
  checkTotalVideoMinutes,
  checkTpScreenshots,
  parseMeanVolume,
} from './qa.js';

/** Construit une question de quiz valide, surchargée au besoin. */
function question(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question: 'Question ?',
    choices: Array.from({ length: QUIZ.CHOICES_PER_QUESTION }, (_, i) => `Choix ${i}`),
    correctIndex: 0,
    explanation: '',
    difficulty: 'beginner',
    ...overrides,
  } as QuizQuestion;
}

describe('checkQuizzes', () => {
  it('accepte un quiz conforme (bon nombre de choix, correctIndex dans les bornes)', () => {
    const problems = checkQuizzes([{ questions: [question(), question({ correctIndex: 3 })] }]);
    expect(problems).toEqual([]);
  });

  it('signale un correctIndex hors bornes', () => {
    const problems = checkQuizzes([{ questions: [question({ correctIndex: 9 })] }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/correctIndex/);
  });

  it('signale un correctIndex négatif', () => {
    const problems = checkQuizzes([{ questions: [question({ correctIndex: -1 })] }]);
    expect(problems).toHaveLength(1);
  });

  it('signale un nombre de choix incorrect', () => {
    const problems = checkQuizzes([{ questions: [question({ choices: ['a', 'b'] })] }]);
    // Mauvais nombre de choix + correctIndex 0 reste valide → un seul problème.
    expect(problems.some((p) => /choix/.test(p))).toBe(true);
  });

  it('signale un quiz sans question', () => {
    const problems = checkQuizzes([{ questions: [] }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/aucune question/);
  });

  it('ne signale rien pour une liste de quiz vide', () => {
    expect(checkQuizzes([])).toEqual([]);
  });
});

describe('checkArticlePlaceholders', () => {
  it('accepte un article sans placeholder résiduel', () => {
    const problems = checkArticlePlaceholders([
      { title: 'A', markdown: '## Titre\n\nDu texte, une image déjà insérée.' },
    ]);
    expect(problems).toEqual([]);
  });

  it('signale un placeholder {{screenshot:…}} non remplacé', () => {
    const problems = checkArticlePlaceholders([
      { title: 'A', markdown: '## Titre\n\n{{screenshot:le terminal}}' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/placeholder/);
    expect(problems[0]).toMatch(/A/);
  });

  it('compte plusieurs placeholders dans un même article', () => {
    const md = '{{screenshot:un}} texte {{screenshot:deux}}';
    const problems = checkArticlePlaceholders([{ title: 'B', markdown: md }]);
    expect(problems[0]).toMatch(/2 placeholder/);
  });
});

describe('checkTpScreenshots (correctif N2, audit 2026-07-20)', () => {
  it('accepte un TP sans capture dégradée', () => {
    const problems = checkTpScreenshots([{ title: 'TP propre', screenshotsCount: 3, degradedCount: 0 }]);
    expect(problems).toEqual([]);
  });

  it('ignore un TP sans capture attendue (ex. purement terminal)', () => {
    const problems = checkTpScreenshots([{ title: 'TP terminal', screenshotsCount: 0, degradedCount: 0 }]);
    expect(problems).toEqual([]);
  });

  it('signale un TP dont la moitié ou plus des captures sont dégradées', () => {
    const problems = checkTpScreenshots([{ title: 'TP fantôme', screenshotsCount: 4, degradedCount: 2 }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/TP fantôme/);
    expect(problems[0]).toMatch(/2\/4/);
  });

  it("n'signale pas un TP dont seule une minorité des captures est dégradée", () => {
    const problems = checkTpScreenshots([{ title: 'TP presque propre', screenshotsCount: 4, degradedCount: 1 }]);
    expect(problems).toEqual([]);
  });
});

describe('checkIllustrationConsistency (correctif 1.8, audit 2026-07-20)', () => {
  it('accepte quand aucune vidéo n’a d’illustration (Modal désactivé pour ce cours)', () => {
    const problems = checkIllustrationConsistency([
      { title: 'L0', hasIllustration: false },
      { title: 'L2', hasIllustration: false },
    ]);
    expect(problems).toEqual([]);
  });

  it('accepte quand toutes les vidéos ont une illustration', () => {
    const problems = checkIllustrationConsistency([
      { title: 'L0', hasIllustration: true },
      { title: 'L2', hasIllustration: true },
    ]);
    expect(problems).toEqual([]);
  });

  it('signale une couverture partielle (échec silencieux ponctuel, cas réel de l’audit)', () => {
    const problems = checkIllustrationConsistency([
      { title: 'L0', hasIllustration: true },
      { title: 'L2', hasIllustration: false },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/L2/);
    expect(problems[0]).toMatch(/1\/2/);
  });

  it('accepte une liste vide (aucune vidéo dans le cours)', () => {
    expect(checkIllustrationConsistency([])).toEqual([]);
  });
});

describe('checkSectionCount', () => {
  it('accepte le minimum Udemy', () => {
    expect(checkSectionCount(UDEMY.MIN_SECTIONS)).toBeNull();
  });

  it('rejette en dessous du minimum', () => {
    const problem = checkSectionCount(UDEMY.MIN_SECTIONS - 1);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(new RegExp(String(UDEMY.MIN_SECTIONS)));
  });
});

describe('checkTotalVideoMinutes', () => {
  it('accepte le minimum Udemy', () => {
    expect(checkTotalVideoMinutes(UDEMY.MIN_TOTAL_VIDEO_MINUTES)).toBeNull();
  });

  it('rejette une durée insuffisante', () => {
    const problem = checkTotalVideoMinutes(UDEMY.MIN_TOTAL_VIDEO_MINUTES - 5);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/min/);
  });
});

describe('parseMeanVolume', () => {
  it('extrait le mean_volume négatif de la sortie ffmpeg', () => {
    expect(parseMeanVolume('[Parsed_volumedetect] mean_volume: -18.4 dB')).toBe(-18.4);
  });

  it('extrait un silence total', () => {
    expect(parseMeanVolume('mean_volume: -91.0 dB')).toBe(-91);
  });

  it('renvoie null quand le motif est absent', () => {
    expect(parseMeanVolume('aucune mesure ici')).toBeNull();
  });
});
