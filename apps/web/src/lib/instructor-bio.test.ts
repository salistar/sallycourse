import { describe, expect, it } from 'vitest';
import { instructorBioSchema } from '@sallycourse/shared/instructor';
import {
  expertiseFromCourses,
  instructorBioSystemPrompt,
  instructorBioUserPrompt,
  mockInstructorBio,
  type InstructorBioInput,
} from './instructor-bio';

const INPUT: InstructorBioInput = {
  name: 'Jean Dupont',
  locale: 'fr',
  courses: [
    { title: 'Robot Framework', summary: 'Automatiser ses tests', lessonCount: 12, durationMin: 90 },
    { title: 'Kubernetes', summary: 'Orchestrer ses conteneurs', lessonCount: 8, durationMin: 60 },
  ],
  platforms: ['udemy', 'youtube'],
  studentCount: 42,
};

describe('expertiseFromCourses', () => {
  it('déduit les domaines des titres, dédupliqués', () => {
    expect(expertiseFromCourses(INPUT.courses)).toEqual(['Robot Framework', 'Kubernetes']);
  });

  it('complète jusqu’au minimum de 2 entrées exigé par le schéma', () => {
    expect(expertiseFromCourses([INPUT.courses[0]!])).toEqual([
      'Robot Framework',
      'Formation en ligne',
    ]);
    expect(expertiseFromCourses([])).toEqual(['Formation en ligne', 'Pédagogie']);
  });
});

describe('mockInstructorBio (MOCK_PROVIDERS — aucune clé API requise)', () => {
  it('produit une bio conforme au schéma partagé', () => {
    const bio = mockInstructorBio(INPUT);
    expect(instructorBioSchema.safeParse(bio).success).toBe(true);
  });

  it('est déterministe et dérivée du catalogue réel', () => {
    expect(mockInstructorBio(INPUT)).toEqual(mockInstructorBio(INPUT));
    const bio = mockInstructorBio(INPUT);
    expect(bio.headline).toContain('Robot Framework');
    expect(bio.bio).toContain('20 leçons');
    expect(bio.bio).toContain('udemy, youtube');
    expect(bio.expertise).toContain('Kubernetes');
  });

  it('reste conforme sans plateforme ni cours (schéma respecté)', () => {
    const bio = mockInstructorBio({ ...INPUT, courses: [], platforms: [], studentCount: 0 });
    expect(instructorBioSchema.safeParse(bio).success).toBe(true);
  });
});

describe('prompts', () => {
  it('le prompt système impose le JSON strict et interdit l’invention', () => {
    const system = instructorBioSystemPrompt();
    expect(system).toContain('"headline"');
    expect(system).toContain('N\'INVENTE RIEN');
  });

  it('le prompt utilisateur ne contient QUE des données publiques', () => {
    const prompt = instructorBioUserPrompt(INPUT);
    expect(prompt).toContain('Robot Framework');
    expect(prompt).toContain('udemy, youtube');
    expect(prompt).toContain('français');
    expect(prompt).not.toContain('@');
  });
});
