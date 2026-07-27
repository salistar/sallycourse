import { describe, expect, it } from 'vitest';
import {
  assistantActionRequiresConfirmation,
  assistantActionSchema,
  dictationBriefSchema,
  dictationSystemPrompt,
  dictationUserPrompt,
  mockBriefFromTranscript,
  toCreateCourseInput,
  whisperLangForDictation,
} from './voice-intent';

describe('whisperLangForDictation', () => {
  it('mappe darija et arabe sur le code arabe, français sur fr', () => {
    expect(whisperLangForDictation('darija')).toBe('ar');
    expect(whisperLangForDictation('ar')).toBe('ar');
    expect(whisperLangForDictation('fr')).toBe('fr');
  });
});

describe('mockBriefFromTranscript', () => {
  it('extrait le sujet après un marqueur français « sur »', () => {
    const brief = mockBriefFromTranscript('Je veux un cours sur Docker pour les débutants', 'fr');
    expect(brief.title.toLowerCase()).toContain('docker');
    expect(brief.difficulty).toBe('beginner');
    expect(brief.locale).toBe('fr');
    expect(brief.audience?.toLowerCase()).toContain('débutant');
  });

  it('rattrape une dictée darija translittérée (marqueur 3la) → locale fr par défaut', () => {
    const brief = mockBriefFromTranscript('bghit ndir cours 3la Kubernetes', 'darija');
    expect(brief.title.toLowerCase()).toContain('kubernetes');
    // La darija n'est jamais une locale de cours : repli sur fr.
    expect(brief.locale).toBe('fr');
    // La darija translittérée est la plus risquée → confiance la plus basse.
    expect(brief.confidence).toBeLessThan(0.5);
  });

  it('produit une locale arabe pour une entrée en arabe standard', () => {
    const brief = mockBriefFromTranscript('formation sur الذكاء الاصطناعي niveau avancé', 'ar');
    expect(brief.locale).toBe('ar');
    expect(brief.difficulty).toBe('advanced');
  });

  it('détecte le niveau intermédiaire', () => {
    const brief = mockBriefFromTranscript('cours sur Python niveau intermédiaire', 'fr');
    expect(brief.difficulty).toBe('intermediate');
  });

  it('est déterministe : même entrée → même brief', () => {
    const a = mockBriefFromTranscript('cours sur Terraform', 'fr');
    const b = mockBriefFromTranscript('cours sur Terraform', 'fr');
    expect(a).toEqual(b);
  });

  it('garantit le plancher de longueur du titre (repli lisible)', () => {
    const brief = mockBriefFromTranscript('a', 'fr');
    expect(brief.title.length).toBeGreaterThanOrEqual(3);
    // Le brief reste conforme au schéma quoi qu'il arrive.
    expect(() => dictationBriefSchema.parse(brief)).not.toThrow();
  });
});

describe('toCreateCourseInput', () => {
  it('mappe le brief vers un createCourseInput valide', () => {
    const brief = dictationBriefSchema.parse({
      title: 'Docker pour les débutants',
      difficulty: 'beginner',
      locale: 'fr',
      approxSections: 6,
      audience: 'débutants',
    });
    const input = toCreateCourseInput(brief);
    expect(input.title).toBe('Docker pour les débutants');
    expect(input.difficulty).toBe('beginner');
    expect(input.locale).toBe('fr');
    expect(input.approxSections).toBe(6);
    expect(input.advancedParams?.audience).toBe('débutants');
  });

  it('omet approxSections/advancedParams quand absents du brief', () => {
    const brief = dictationBriefSchema.parse({ title: 'Kubernetes', difficulty: 'advanced', locale: 'en' });
    const input = toCreateCourseInput(brief);
    expect(input.approxSections).toBeUndefined();
    expect(input.advancedParams).toBeUndefined();
  });
});

describe('prompts de dictée', () => {
  it('le prompt système contient des exemples darija few-shot', () => {
    const sys = dictationSystemPrompt();
    expect(sys).toContain('darija');
    expect(sys).toContain('3la');
    expect(sys).toContain('Docker');
  });

  it('le prompt utilisateur inclut la transcription et la langue déclarée', () => {
    const user = dictationUserPrompt('bghit cours 3la Git', 'darija');
    expect(user).toContain('bghit cours 3la Git');
    expect(user).toContain('darija');
  });
});

describe('assistantActionSchema', () => {
  it('valide une action create_course avec un input de cours conforme', () => {
    const parsed = assistantActionSchema.safeParse({
      type: 'create_course',
      input: { title: 'Mon cours', difficulty: 'beginner' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejette une action inconnue', () => {
    expect(assistantActionSchema.safeParse({ type: 'delete_everything' }).success).toBe(false);
  });

  it('valide une action none avec raison', () => {
    const parsed = assistantActionSchema.safeParse({ type: 'none', reason: 'intention ambiguë' });
    expect(parsed.success).toBe(true);
  });

  it('marque les actions mutantes comme nécessitant confirmation, pas « none »', () => {
    expect(
      assistantActionRequiresConfirmation({ type: 'deploy_course', courseId: 'c1' }),
    ).toBe(true);
    expect(assistantActionRequiresConfirmation({ type: 'none', reason: 'x' })).toBe(false);
  });
});
