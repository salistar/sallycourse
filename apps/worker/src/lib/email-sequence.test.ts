// Tests des séquences email marketing (Prompt 140) :
//  1) génération de séquence (mock déterministe hors-ligne, sans callClaudeJson) ;
//  2) calcul PUR de nextSendAt / advanceEnrollment (aucune I/O) ;
//  3) détection des inscriptions inactives (LMS interne, P43) ;
//  4) interpolation des variables du gabarit.
import { describe, expect, it } from 'vitest';
import {
  advanceEnrollment,
  computeNextSendAt,
  emailSequenceGenerationSchema,
  interpolateTemplate,
  mockEmailSequenceGeneration,
  selectInactiveEnrollments,
  WINBACK_INACTIVITY_DAYS,
} from './email-sequence.js';

describe('mockEmailSequenceGeneration (fixture déterministe hors-ligne)', () => {
  it('produit une séquence de lancement conforme au schéma', () => {
    const gen = mockEmailSequenceGeneration('Maîtriser React', 'launch');
    expect(emailSequenceGenerationSchema.safeParse(gen).success).toBe(true);
    expect(gen.steps.length).toBe(2);
    expect(gen.steps[0]?.delayDays).toBe(0);
    expect(gen.steps.every((s) => s.subject.includes('React'))).toBe(true);
  });

  it('produit une séquence de nurturing à 5 étapes espacées', () => {
    const gen = mockEmailSequenceGeneration('Python pour débutants', 'nurturing');
    expect(gen.steps.length).toBe(5);
    const delays = gen.steps.map((s) => s.delayDays);
    expect(delays).toEqual([0, 3, 7, 14, 21]);
    // Strictement croissant.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('produit une séquence winback courte', () => {
    const gen = mockEmailSequenceGeneration('Docker avancé', 'winback');
    expect(gen.steps.length).toBe(2);
    expect(gen.steps[0]?.delayDays).toBe(0);
  });

  it('est déterministe pour un même titre + type', () => {
    const a = mockEmailSequenceGeneration('Cours X', 'nurturing');
    const b = mockEmailSequenceGeneration('Cours X', 'nurturing');
    expect(a).toEqual(b);
  });

  it('chaque bodyTemplate référence bien {{name}} et {{courseTitle}}', () => {
    const gen = mockEmailSequenceGeneration('Cours Y', 'launch');
    for (const step of gen.steps) {
      expect(step.bodyTemplate).toContain('{{name}}');
      expect(step.bodyTemplate).toContain('{{courseTitle}}');
    }
  });
});

describe('computeNextSendAt (pure)', () => {
  it('ajoute delayDays jours à la date d’inscription', () => {
    const enrolledAt = new Date('2026-07-01T10:00:00Z');
    const result = computeNextSendAt(enrolledAt, 7);
    expect(result.toISOString()).toBe('2026-07-08T10:00:00.000Z');
  });

  it('delayDays=0 renvoie exactement enrolledAt (envoi immédiat)', () => {
    const enrolledAt = new Date('2026-07-01T10:00:00Z');
    expect(computeNextSendAt(enrolledAt, 0).getTime()).toBe(enrolledAt.getTime());
  });
});

describe('advanceEnrollment (pure)', () => {
  const steps = [
    { delayDays: 0, subject: 'A', bodyTemplate: 'a' },
    { delayDays: 3, subject: 'B', bodyTemplate: 'b' },
    { delayDays: 7, subject: 'C', bodyTemplate: 'c' },
  ];
  const enrolledAt = new Date('2026-01-01T00:00:00Z');

  it('avance vers la prochaine étape et calcule nextSendAt depuis enrolledAt (pas depuis now)', () => {
    const result = advanceEnrollment(steps, 0, enrolledAt);
    expect(result.status).toBe('active');
    expect(result.nextStepIndex).toBe(1);
    expect(result.nextSendAt).toEqual(computeNextSendAt(enrolledAt, 3));
  });

  it('clôture la séquence après la dernière étape', () => {
    const result = advanceEnrollment(steps, 2, enrolledAt);
    expect(result.status).toBe('completed');
    expect(result.nextStepIndex).toBe(3);
  });

  it('ne dérive pas cumulativement : nextSendAt reste ancré sur enrolledAt même en cas de retard', () => {
    // Même si le cron traite l'étape 1 en retard, l'étape suivante reste
    // calculée depuis enrolledAt (delayDays=7), pas depuis "maintenant".
    const result = advanceEnrollment(steps, 1, enrolledAt);
    expect(result.nextSendAt).toEqual(computeNextSendAt(enrolledAt, 7));
  });
});

describe('selectInactiveEnrollments (LMS interne, P43)', () => {
  const now = new Date('2026-07-11T00:00:00Z');

  it('sélectionne les enrollments sans activité récente et non complétés', () => {
    const enrollments = [
      { id: '1', studentId: 's1', courseTitle: 'A', updatedAt: new Date('2026-05-01T00:00:00Z') }, // inactif
      { id: '2', studentId: 's2', courseTitle: 'A', updatedAt: new Date('2026-07-10T00:00:00Z') }, // actif récemment
      { id: '3', studentId: 's3', courseTitle: 'A', updatedAt: new Date('2026-04-01T00:00:00Z'), completedAt: new Date('2026-04-02T00:00:00Z') }, // complété
    ];
    const inactive = selectInactiveEnrollments(enrollments, now);
    expect(inactive.map((e) => e.id)).toEqual(['1']);
  });

  it('respecte un seuil personnalisé', () => {
    const enrollments = [{ id: '1', studentId: 's1', courseTitle: 'A', updatedAt: new Date('2026-07-05T00:00:00Z') }];
    expect(selectInactiveEnrollments(enrollments, now, 3).length).toBe(1);
    expect(selectInactiveEnrollments(enrollments, now, 30).length).toBe(0);
  });

  it('seuil par défaut = 30 jours', () => {
    expect(WINBACK_INACTIVITY_DAYS).toBe(30);
  });
});

describe('interpolateTemplate', () => {
  it('remplace {{name}} et {{courseTitle}}', () => {
    const result = interpolateTemplate('Bonjour {{name}}, continuez {{courseTitle}} !', {
      name: 'Nadia',
      courseTitle: 'Python avancé',
    });
    expect(result).toBe('Bonjour Nadia, continuez Python avancé !');
  });

  it('retombe sur des valeurs génériques si absentes', () => {
    const result = interpolateTemplate('Bonjour {{name}}, {{courseTitle}}', {});
    expect(result).toContain('Bonjour là');
    expect(result).toContain('votre cours');
  });
});
