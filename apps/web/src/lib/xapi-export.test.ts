import { describe, it, expect } from 'vitest';
import { buildLessonStatement, generateXapiReport } from './xapi-export';
import type { XapiActorInput } from './xapi-export';

const actor: XapiActorInput = { studentId: 's1', name: 'Amine El Fassi', email: 'amine@example.com' };

describe('buildLessonStatement', () => {
  it('génère un statement xAPI minimal valide', () => {
    const statement = buildLessonStatement(actor, 'course1', {
      lessonId: 'lesson1',
      lessonTitle: 'Introduction',
      completedAt: new Date('2026-01-15T10:00:00Z'),
    });
    expect(statement.actor.name).toBe('Amine El Fassi');
    expect(statement.actor.mbox).toBe('mailto:amine@example.com');
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed');
    expect(statement.object.id).toContain('course1');
    expect(statement.object.id).toContain('lesson1');
    expect(statement.object.definition.name['fr-FR']).toBe('Introduction');
    expect(statement.result?.completion).toBe(true);
    expect(statement.timestamp).toBe('2026-01-15T10:00:00.000Z');
  });

  it('inclut la durée ISO 8601 quand timeSpentSeconds est fourni', () => {
    const statement = buildLessonStatement(actor, 'course1', {
      lessonId: 'lesson1',
      lessonTitle: 'Introduction',
      completedAt: new Date(),
      timeSpentSeconds: 90,
    });
    expect(statement.result?.duration).toBe('PT90S');
  });

  it('inclut le score normalisé (scaled 0-1) quand un score est fourni', () => {
    const statement = buildLessonStatement(actor, 'course1', {
      lessonId: 'quiz1',
      lessonTitle: 'Quiz final',
      completedAt: new Date(),
      score: 80,
    });
    expect(statement.result?.score).toEqual({ raw: 80, min: 0, max: 100, scaled: 0.8 });
  });

  it('mbox retombe sur un domaine local si l’email est invalide', () => {
    const statement = buildLessonStatement(
      { studentId: 's1', name: 'Test', email: 'invalide' },
      'course1',
      { lessonId: 'l1', lessonTitle: 'L1', completedAt: new Date() },
    );
    expect(statement.actor.mbox).toBe('mailto:invalide@sallycourse.local');
  });
});

describe('generateXapiReport', () => {
  it('produit un statement par leçon complétée, dans l’ordre fourni', () => {
    const report = generateXapiReport({
      actor,
      courseId: 'course1',
      courseTitle: 'Développement web',
      lessons: [
        { lessonId: 'l1', lessonTitle: 'Intro', completedAt: new Date('2026-01-01') },
        { lessonId: 'l2', lessonTitle: 'Suite', completedAt: new Date('2026-01-02') },
      ],
    });
    expect(report.version).toBe('1.0.3');
    expect(report.statements).toHaveLength(2);
    expect(report.statements[0]!.object.id).toContain('l1');
    expect(report.statements[1]!.object.id).toContain('l2');
  });

  it('ajoute un statement de complétion du cours si courseCompletedAt est fourni', () => {
    const report = generateXapiReport({
      actor,
      courseId: 'course1',
      courseTitle: 'Développement web',
      lessons: [{ lessonId: 'l1', lessonTitle: 'Intro', completedAt: new Date('2026-01-01') }],
      courseCompletedAt: new Date('2026-01-03'),
    });
    expect(report.statements).toHaveLength(2);
    const courseStatement = report.statements[1]!;
    expect(courseStatement.object.id).toBe('https://sallycourse.com/learn/course1');
    expect(courseStatement.object.definition.type).toBe('http://adlnet.gov/expapi/activities/course');
  });

  it('sans courseCompletedAt, aucun statement de cours ajouté', () => {
    const report = generateXapiReport({
      actor,
      courseId: 'course1',
      courseTitle: 'Développement web',
      lessons: [],
    });
    expect(report.statements).toHaveLength(0);
  });

  it('le JSON produit est sérialisable (valide) et stable', () => {
    const report = generateXapiReport({
      actor,
      courseId: 'course1',
      courseTitle: 'Développement web',
      lessons: [{ lessonId: 'l1', lessonTitle: 'Intro', completedAt: new Date('2026-01-01') }],
    });
    expect(() => JSON.stringify(report)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(report));
    expect(parsed.statements[0].verb.display['en-US']).toBe('completed');
  });
});
