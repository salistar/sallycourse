// Tests exhaustifs du module udemy-compliance : cas limites de chaque règle,
// corrections mécaniques suggérées, score et verdict.
import { describe, expect, it } from 'vitest';
import { UDEMY } from './constants';
import {
  checkUdemyCompliance,
  countWords,
  normalizeTitleCase,
  smartTruncate,
  uppercaseRatio,
  type ComplianceIssueCode,
  type UdemyComplianceInput,
} from './udemy-compliance';

// Input entièrement conforme ; chaque test dérive du cas nominal par override.
function baseInput(overrides: Partial<UdemyComplianceInput> = {}): UdemyComplianceInput {
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
    lessons: [
      { type: 'video', durationMin: 8, hasVideo: true },
      { type: 'article', durationMin: 5, hasVideo: false },
      { type: 'quiz', durationMin: 10, hasVideo: false },
    ],
    courseImage: { width: 750, height: 422 },
    locale: 'fr',
    ...overrides,
  };
}

function codes(input: UdemyComplianceInput): ComplianceIssueCode[] {
  return checkUdemyCompliance(input).issues.map((i) => i.code);
}

function issueOf(input: UdemyComplianceInput, code: ComplianceIssueCode) {
  return checkUdemyCompliance(input).issues.find((i) => i.code === code);
}

describe('cas nominal', () => {
  it('un cours conforme obtient 100, passed=true, zéro issue', () => {
    const report = checkUdemyCompliance(baseInput());
    expect(report.issues).toEqual([]);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });
});

describe('titre — longueur', () => {
  it('accepte exactement 60 caractères', () => {
    const title = 'x'.repeat(UDEMY.TITLE_MAX_CHARS);
    expect(codes(baseInput({ title }))).not.toContain('TITLE_TOO_LONG');
  });

  it('rejette 61 caractères avec une troncature suggérée <= 60', () => {
    const title = 'x'.repeat(UDEMY.TITLE_MAX_CHARS + 1);
    const issue = issueOf(baseInput({ title }), 'TITLE_TOO_LONG');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix?.field).toBe('title');
    expect(issue?.fix?.suggested.length).toBeLessThanOrEqual(UDEMY.TITLE_MAX_CHARS);
  });

  it('la troncature suggérée coupe à une frontière de mot', () => {
    const title = 'Formation complete au developpement web moderne avec projets guides';
    expect(title.length).toBeGreaterThan(UDEMY.TITLE_MAX_CHARS);
    const issue = issueOf(baseInput({ title }), 'TITLE_TOO_LONG');
    const suggested = issue?.fix?.suggested ?? '';
    expect(suggested.length).toBeLessThanOrEqual(UDEMY.TITLE_MAX_CHARS);
    expect(title.startsWith(suggested)).toBe(true);
    // le caractère suivant dans l'original est un espace : aucun mot coupé
    expect(title.charAt(suggested.length)).toBe(' ');
  });

  it('la suggestion réappliquée ne déclenche plus TITLE_TOO_LONG', () => {
    const title = 'Formation complete au developpement web moderne avec projets guides';
    const suggested = issueOf(baseInput({ title }), 'TITLE_TOO_LONG')?.fix?.suggested ?? '';
    expect(codes(baseInput({ title: suggested }))).not.toContain('TITLE_TOO_LONG');
  });
});

describe('titre — mots interdits (FR/EN/AR)', () => {
  it.each(['Cours gratuit de Python', 'Learn Python FREE today', 'دورة بايثون مجاني للمبتدئين'])(
    'rejette « %s »',
    (title) => {
      const issue = issueOf(baseInput({ title }), 'TITLE_FORBIDDEN_WORD');
      expect(issue?.severity).toBe('error');
    },
  );

  it('la suppression suggérée du mot interdit est appliquée proprement', () => {
    const issue = issueOf(baseInput({ title: 'Cours gratuit de Python' }), 'TITLE_FORBIDDEN_WORD');
    expect(issue?.fix?.suggested).toBe('Cours de Python');
  });

  it('ne flague pas les mots contenant la racine (gratuitement, freedom)', () => {
    expect(codes(baseInput({ title: 'Progresser gratuitement vers la freedom' }))).not.toContain(
      'TITLE_FORBIDDEN_WORD',
    );
  });
});

describe('titre — majuscules abusives', () => {
  it('rejette un titre tout en majuscules avec une casse corrigée', () => {
    const issue = issueOf(baseInput({ title: 'APPRENDRE PYTHON MAINTENANT' }), 'TITLE_EXCESSIVE_CAPS');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix?.suggested).toBe('Apprendre Python Maintenant');
  });

  it('la suggestion réappliquée ne déclenche plus TITLE_EXCESSIVE_CAPS', () => {
    const suggested =
      issueOf(baseInput({ title: 'APPRENDRE PYTHON MAINTENANT' }), 'TITLE_EXCESSIVE_CAPS')?.fix
        ?.suggested ?? '';
    expect(codes(baseInput({ title: suggested }))).not.toContain('TITLE_EXCESSIVE_CAPS');
  });

  it('tolère les sigles courts (SQL, PHP)', () => {
    expect(codes(baseInput({ title: 'Apprendre SQL et PHP simplement' }))).not.toContain(
      'TITLE_EXCESSIVE_CAPS',
    );
  });

  it('exactement 30 % de majuscules passe, au-delà échoue', () => {
    // 3 majuscules sur 10 lettres = 30 % pile (mot non tout-majuscules, donc compté)
    expect(codes(baseInput({ title: 'AAAbbbbbbb' }))).not.toContain('TITLE_EXCESSIVE_CAPS');
    // 4 sur 10 = 40 %
    expect(codes(baseInput({ title: 'AAAAbbbbbb' }))).toContain('TITLE_EXCESSIVE_CAPS');
  });
});

describe('titre — exclamations et superlatifs', () => {
  it('rejette « !! » et suggère un seul « ! »', () => {
    const issue = issueOf(baseInput({ title: 'Python en 7 jours !!' }), 'TITLE_MULTIPLE_EXCLAMATIONS');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix?.suggested).toBe('Python en 7 jours !');
  });

  it('accepte un unique point d’exclamation', () => {
    expect(codes(baseInput({ title: 'Python en 7 jours !' }))).not.toContain(
      'TITLE_MULTIPLE_EXCLAMATIONS',
    );
  });

  it.each(['Le meilleur cours Python', 'The Best Course on Python'])(
    'rejette l’allégation superlative « %s » (sans fix mécanique)',
    (title) => {
      const issue = issueOf(baseInput({ title }), 'TITLE_SUPERLATIVE_CLAIM');
      expect(issue?.severity).toBe('error');
      expect(issue?.fix).toBeUndefined();
    },
  );
});

describe('sous-titre', () => {
  it('accepte exactement 120 caractères', () => {
    const subtitle = 's'.repeat(UDEMY.SUBTITLE_MAX_CHARS);
    expect(codes(baseInput({ subtitle }))).not.toContain('SUBTITLE_TOO_LONG');
  });

  it('rejette 121 caractères avec troncature suggérée', () => {
    const subtitle = 's'.repeat(UDEMY.SUBTITLE_MAX_CHARS + 1);
    const issue = issueOf(baseInput({ subtitle }), 'SUBTITLE_TOO_LONG');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix?.field).toBe('subtitle');
    expect(issue?.fix?.suggested.length).toBeLessThanOrEqual(UDEMY.SUBTITLE_MAX_CHARS);
  });
});

describe('description, objectifs, vidéo, sections', () => {
  it('accepte 200 mots, rejette 199', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    expect(codes(baseInput({ description: words(UDEMY.DESCRIPTION_MIN_WORDS) }))).not.toContain(
      'DESCRIPTION_TOO_SHORT',
    );
    const issue = issueOf(
      baseInput({ description: words(UDEMY.DESCRIPTION_MIN_WORDS - 1) }),
      'DESCRIPTION_TOO_SHORT',
    );
    expect(issue?.severity).toBe('error');
  });

  it('accepte 4 objectifs, rejette 3', () => {
    expect(codes(baseInput())).not.toContain('OBJECTIVES_TOO_FEW');
    const issue = issueOf(
      baseInput({ learningObjectives: ['a', 'b', 'c'] }),
      'OBJECTIVES_TOO_FEW',
    );
    expect(issue?.severity).toBe('error');
  });

  it('accepte 30 minutes de vidéo, rejette 29', () => {
    expect(codes(baseInput({ totalVideoMinutes: UDEMY.MIN_TOTAL_VIDEO_MINUTES }))).not.toContain(
      'VIDEO_TOO_SHORT',
    );
    const issue = issueOf(baseInput({ totalVideoMinutes: 29 }), 'VIDEO_TOO_SHORT');
    expect(issue?.severity).toBe('error');
  });

  it('accepte 5 sections, rejette 4', () => {
    expect(codes(baseInput({ sectionsCount: UDEMY.MIN_SECTIONS }))).not.toContain('SECTIONS_TOO_FEW');
    const issue = issueOf(baseInput({ sectionsCount: 4 }), 'SECTIONS_TOO_FEW');
    expect(issue?.severity).toBe('error');
  });
});

describe('image de cours', () => {
  it('accepte exactement 750x422', () => {
    expect(codes(baseInput())).not.toContain('IMAGE_WRONG_SIZE');
  });

  it.each([
    [750, 421],
    [749, 422],
    [1500, 844],
  ])('rejette %dx%d (dimensions exactes exigées)', (width, height) => {
    const issue = issueOf(baseInput({ courseImage: { width, height } }), 'IMAGE_WRONG_SIZE');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix?.suggested).toBe('750x422');
  });

  it('image absente = avertissement, le verdict reste passed', () => {
    const report = checkUdemyCompliance(baseInput({ courseImage: undefined }));
    const issue = report.issues.find((i) => i.code === 'IMAGE_MISSING');
    expect(issue?.severity).toBe('warning');
    expect(report.passed).toBe(true);
    expect(report.score).toBe(95);
  });
});

describe('URL et promo dans les textes', () => {
  it('rejette une URL http(s) dans la description', () => {
    const description = `${baseInput().description} voir https://example.com pour plus`;
    const issue = issueOf(baseInput({ description }), 'TEXT_CONTAINS_URL');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('description');
  });

  it('rejette une URL www. dans le sous-titre', () => {
    const issue = issueOf(
      baseInput({ subtitle: 'Retrouvez tout sur www.example.com des maintenant' }),
      'TEXT_CONTAINS_URL',
    );
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('subtitle');
  });

  it('émet une issue URL par champ fautif', () => {
    const input = baseInput({
      title: 'Python via https://a.io',
      description: `${baseInput().description} https://b.io`,
    });
    const urlIssues = checkUdemyCompliance(input).issues.filter((i) => i.code === 'TEXT_CONTAINS_URL');
    expect(urlIssues).toHaveLength(2);
  });

  it.each(['coupon exclusif inclus', 'Grosse Réduction cette semaine', 'عرض خصم كبير'])(
    'rejette le vocabulaire promotionnel « %s »',
    (fragment) => {
      const description = `${baseInput().description} ${fragment}`;
      const issue = issueOf(baseInput({ description }), 'TEXT_CONTAINS_PROMO');
      expect(issue?.severity).toBe('error');
    },
  );

  it('ne flague pas un texte sain', () => {
    const report = checkUdemyCompliance(baseInput());
    expect(report.issues.map((i) => i.code)).not.toContain('TEXT_CONTAINS_PROMO');
  });
});

describe('leçons vidéo', () => {
  it('avertit quand une leçon vidéo n’a pas de vidéo', () => {
    const lessons = [
      { type: 'video' as const, durationMin: 8, hasVideo: false },
      { type: 'video' as const, durationMin: 6, hasVideo: true },
    ];
    const issue = issueOf(baseInput({ lessons }), 'VIDEO_LESSON_WITHOUT_VIDEO');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('1');
  });

  it('ignore les leçons article/quiz/tp sans vidéo', () => {
    expect(codes(baseInput())).not.toContain('VIDEO_LESSON_WITHOUT_VIDEO');
  });
});

describe('score et verdict', () => {
  it('une erreur coûte 15 points et invalide le cours', () => {
    const report = checkUdemyCompliance(baseInput({ sectionsCount: 4 }));
    expect(report.score).toBe(85);
    expect(report.passed).toBe(false);
  });

  it('un avertissement coûte 5 points sans invalider', () => {
    const report = checkUdemyCompliance(baseInput({ courseImage: undefined }));
    expect(report.score).toBe(95);
    expect(report.passed).toBe(true);
  });

  it('le score plancher est 0 quand tout est cassé', () => {
    const report = checkUdemyCompliance(
      baseInput({
        title: 'LE MEILLEUR COURS GRATUIT !! www.spam.io free promo',
        subtitle: 's'.repeat(200),
        description: 'trop court',
        learningObjectives: [],
        totalVideoMinutes: 0,
        sectionsCount: 0,
        courseImage: { width: 10, height: 10 },
        lessons: [{ type: 'video', durationMin: 1, hasVideo: false }],
      }),
    );
    expect(report.score).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.issues.length).toBeGreaterThanOrEqual(7);
  });
});

describe('aides mécaniques', () => {
  it('smartTruncate laisse intact un texte assez court', () => {
    expect(smartTruncate('court', 60)).toBe('court');
  });

  it('smartTruncate retire la ponctuation pendante', () => {
    expect(smartTruncate('Un titre, vraiment tres long, oui,', 22)).toBe('Un titre, vraiment');
  });

  it('normalizeTitleCase préserve les sigles et capitalise le reste', () => {
    expect(normalizeTitleCase('MAITRISER SQL VITE')).toBe('Maitriser SQL Vite');
  });

  it('uppercaseRatio vaut 0 sans lettre cassable (chiffres, arabe)', () => {
    expect(uppercaseRatio('2024 دورة بايثون')).toBe(0);
  });

  it('countWords ignore les blancs multiples', () => {
    expect(countWords('  un   deux\n trois  ')).toBe(3);
  });
});
