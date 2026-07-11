// Tests de la déduplication de contenu généré (P115) : similarité de textes
// (identiques, différents, paraphrase partielle) et détection inter-leçons.
import { describe, expect, it } from 'vitest';
import { CONTENT_SIMILARITY } from '../shared.js';
import {
  compareSimilarity,
  extractComparableLessonText,
  findMostSimilarLesson,
  hashSimilarityFingerprint,
  isSimilarityWarning,
} from './content-similarity.js';

const ARTICLE_A =
  'React est une bibliothèque JavaScript pour construire des interfaces utilisateur. ' +
  'Elle utilise un DOM virtuel pour optimiser les mises à jour et repose sur des composants ' +
  'réutilisables qui encapsulent leur propre état et logique de rendu.';

describe('compareSimilarity', () => {
  it('retourne 1 pour deux textes strictement identiques', () => {
    expect(compareSimilarity(ARTICLE_A, ARTICLE_A)).toBe(1);
  });

  it('retourne 1 pour deux textes vides (rien à comparer, pas de faux positif)', () => {
    expect(compareSimilarity('', '')).toBe(1);
  });

  it('retourne 0 pour deux textes complètement différents', () => {
    const textB =
      'Le café éthiopien pousse en altitude sur des sols volcaniques riches en minéraux. ' +
      'Sa récolte manuelle garantit une sélection rigoureuse des grains les plus mûrs.';
    const score = compareSimilarity(ARTICLE_A, textB);
    expect(score).toBeLessThan(0.05);
  });

  it('donne un score intermédiaire pour une paraphrase partielle', () => {
    // Même contenu que ARTICLE_A mais reformulé en partie + phrase ajoutée.
    const paraphrase =
      'React est une bibliothèque JavaScript pour construire des interfaces utilisateur. ' +
      'Le hot reload permet de voir les changements instantanément pendant le développement. ' +
      'Les hooks simplifient la gestion du cycle de vie des composants fonctionnels.';
    const score = compareSimilarity(ARTICLE_A, paraphrase);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('est symétrique (A,B) == (B,A)', () => {
    const textB = 'Autre contenu totalement distinct, sans rapport thématique avec le premier texte.';
    expect(compareSimilarity(ARTICLE_A, textB)).toBe(compareSimilarity(textB, ARTICLE_A));
  });

  it('score 0 quand un seul des deux textes est vide', () => {
    expect(compareSimilarity(ARTICLE_A, '')).toBe(0);
    expect(compareSimilarity('', ARTICLE_A)).toBe(0);
  });
});

describe('hashSimilarityFingerprint', () => {
  it('produit le même fingerprint pour un texte identique', () => {
    const a = hashSimilarityFingerprint(ARTICLE_A);
    const b = hashSimilarityFingerprint(ARTICLE_A);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('ignore la casse et la ponctuation', () => {
    const a = hashSimilarityFingerprint('Bonjour le monde, comment ça va ?');
    const b = hashSimilarityFingerprint('bonjour le monde comment ca va');
    // Les accents diffèrent (ça/ca) mais le recouvrement doit rester élevé.
    expect(compareSimilarity('Bonjour le monde, comment ça va ?', 'bonjour le monde comment ca va')).toBeGreaterThan(
      0.4,
    );
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
  });

  it('exclut les blocs de code fencés du fingerprint', () => {
    const withCode = 'Voici un exemple : ```const x = 1;``` et la suite du texte explicatif complet.';
    const withoutCode = 'Voici un exemple :  et la suite du texte explicatif complet.';
    expect(compareSimilarity(withCode, withoutCode)).toBe(1);
  });

  it('retourne un ensemble non vide même sous la taille de n-gram (texte court)', () => {
    const fp = hashSimilarityFingerprint('salut');
    expect(fp.size).toBe(1);
  });
});

describe('isSimilarityWarning', () => {
  it('déclenche au-dessus ou égal au seuil configuré', () => {
    expect(isSimilarityWarning(CONTENT_SIMILARITY.WARNING_THRESHOLD)).toBe(true);
    expect(isSimilarityWarning(1)).toBe(true);
  });

  it('ne déclenche pas sous le seuil', () => {
    expect(isSimilarityWarning(CONTENT_SIMILARITY.WARNING_THRESHOLD - 0.01)).toBe(false);
    expect(isSimilarityWarning(0)).toBe(false);
  });
});

describe('extractComparableLessonText', () => {
  it('extrait la narration des slides pour une leçon vidéo', () => {
    const lesson = {
      type: 'video' as const,
      title: 'Intro',
      summary: 'résumé outline',
      script: { slides: [{ narration: 'Bonjour' }, { narration: 'et bienvenue' }] },
      assets: {} as never,
    };
    expect(extractComparableLessonText(lesson)).toBe('Bonjour et bienvenue');
  });

  it('extrait objectif + instructions pour une leçon TP', () => {
    const lesson = {
      type: 'tp' as const,
      title: 'Exercice',
      summary: 'résumé outline',
      script: { objective: 'Construire une API', steps: [{ instruction: 'Créer une route' }] },
      assets: {} as never,
    };
    expect(extractComparableLessonText(lesson)).toBe('Construire une API Créer une route');
  });

  it('extrait articleMd pour une leçon article', () => {
    const lesson = {
      type: 'article' as const,
      title: 'Article',
      summary: 'résumé outline',
      script: undefined,
      assets: { articleMd: 'Contenu réel de l\'article.' } as never,
    };
    expect(extractComparableLessonText(lesson)).toBe("Contenu réel de l'article.");
  });

  it('retombe sur le résumé/titre si aucun contenu généré disponible', () => {
    const lesson = {
      type: 'quiz' as const,
      title: 'Quiz final',
      summary: 'résumé outline',
      script: undefined,
      assets: {} as never,
    };
    expect(extractComparableLessonText(lesson)).toBe('résumé outline');
  });
});

describe('findMostSimilarLesson', () => {
  it('retourne undefined sans leçon proche', () => {
    const candidate = {
      type: 'article' as const,
      title: 'A',
      summary: '',
      script: undefined,
      assets: { articleMd: ARTICLE_A } as never,
    };
    const others = [
      {
        id: 'l1',
        lesson: {
          type: 'article' as const,
          title: 'B',
          summary: '',
          script: undefined,
          assets: { articleMd: 'Un texte totalement différent sur un tout autre sujet culinaire.' } as never,
        },
      },
    ];
    expect(findMostSimilarLesson(candidate, others)).toBeUndefined();
  });

  it('détecte la leçon quasi-identique et retourne son score', () => {
    const candidate = {
      type: 'article' as const,
      title: 'A',
      summary: '',
      script: undefined,
      assets: { articleMd: ARTICLE_A } as never,
    };
    const others = [
      {
        id: 'l1',
        lesson: {
          type: 'article' as const,
          title: 'B',
          summary: '',
          script: undefined,
          assets: { articleMd: 'Un texte totalement différent sur un tout autre sujet culinaire.' } as never,
        },
      },
      {
        id: 'l2',
        lesson: {
          type: 'article' as const,
          title: 'C (doublon)',
          summary: '',
          script: undefined,
          assets: { articleMd: ARTICLE_A } as never,
        },
      },
    ];
    const match = findMostSimilarLesson(candidate, others);
    expect(match).toBeDefined();
    expect(match?.lessonId).toBe('l2');
    expect(match?.score).toBe(1);
  });
});
