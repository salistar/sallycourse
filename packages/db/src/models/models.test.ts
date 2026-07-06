import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { User } from './user';
import { Course } from './course';
import { Section } from './section';
import { Lesson } from './lesson';
import { Quiz } from './quiz';
import { GenerationJob } from './generation-job';
import { Deployment } from './deployment';

// Validation pure (validateSync) — aucune connexion Mongo requise.

const oid = () => new Types.ObjectId();

describe('User', () => {
  it('accepte un document valide et applique les défauts', () => {
    const doc = new User({
      email: 'test@example.com',
      passwordHash: 'hash',
      name: 'Test',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.plan).toBe('free');
    expect(doc.role).toBe('user');
    expect(doc.locale).toBe('fr');
    expect(doc.quotaUsed.coursesThisMonth).toBe(0);
  });

  it('rejette un plan inconnu et les champs requis manquants', () => {
    const doc = new User({ email: 'a@b.c', plan: 'platinum' });
    const err = doc.validateSync();
    expect(err?.errors['plan']).toBeDefined();
    expect(err?.errors['passwordHash']).toBeDefined();
    expect(err?.errors['name']).toBeDefined();
  });
});

describe('Course', () => {
  it('accepte un document valide', () => {
    const doc = new Course({
      userId: oid(),
      title: 'Apprendre TypeScript',
      difficulty: 'beginner',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('draft');
  });

  it('rejette un statut inconnu', () => {
    const doc = new Course({
      userId: oid(),
      title: 'X',
      difficulty: 'beginner',
      status: 'oops',
    });
    expect(doc.validateSync()?.errors['status']).toBeDefined();
  });

  it('valide outline via le schéma Zod partagé', () => {
    const doc = new Course({
      userId: oid(),
      title: 'X',
      difficulty: 'beginner',
      outline: { title: '' }, // invalide pour outlineSchema
    });
    expect(doc.validateSync()?.errors['outline']).toBeDefined();
  });
});

describe('Section', () => {
  it('exige courseId, order et title', () => {
    expect(
      new Section({ courseId: oid(), order: 0, title: 'Intro' }).validateSync(),
    ).toBeUndefined();
    const err = new Section({}).validateSync();
    expect(err?.errors['courseId']).toBeDefined();
    expect(err?.errors['order']).toBeDefined();
    expect(err?.errors['title']).toBeDefined();
  });
});

describe('Lesson', () => {
  it('accepte un document valide avec défauts', () => {
    const doc = new Lesson({
      sectionId: oid(),
      courseId: oid(),
      order: 1,
      title: 'Les bases',
      type: 'video',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('pending');
    expect(doc.assets.screenshots).toEqual([]);
  });

  it('rejette un type de leçon inconnu', () => {
    const doc = new Lesson({
      sectionId: oid(),
      courseId: oid(),
      order: 1,
      title: 'X',
      type: 'podcast',
    });
    expect(doc.validateSync()?.errors['type']).toBeDefined();
  });
});

describe('Quiz', () => {
  const question = {
    question: 'Que fait tsc ?',
    choices: ['Compile', 'Teste', 'Lint', 'Déploie'],
    correctIndex: 0,
    explanation: 'tsc compile le TypeScript.',
    difficulty: 'beginner',
  };

  it('accepte un quiz avec 4 choix par question', () => {
    const doc = new Quiz({
      lessonId: oid(),
      sectionId: oid(),
      courseId: oid(),
      questions: [question],
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejette une question à 3 choix ou un correctIndex hors bornes', () => {
    const bad = new Quiz({
      lessonId: oid(),
      sectionId: oid(),
      courseId: oid(),
      questions: [
        { ...question, choices: ['a', 'b', 'c'] },
        { ...question, correctIndex: 7 },
      ],
    });
    const err = bad.validateSync();
    expect(err?.errors['questions.0.choices']).toBeDefined();
    expect(err?.errors['questions.1.correctIndex']).toBeDefined();
  });
});

describe('GenerationJob', () => {
  it('accepte un job valide et borne progress à 0-100', () => {
    const ok = new GenerationJob({ courseId: oid(), step: 'outline' });
    expect(ok.validateSync()).toBeUndefined();
    expect(ok.progress).toBe(0);
    expect(ok.attempts).toBe(0);

    const bad = new GenerationJob({ courseId: oid(), step: 'outline', progress: 150 });
    expect(bad.validateSync()?.errors['progress']).toBeDefined();
  });

  it('valide les entrées de log', () => {
    const doc = new GenerationJob({
      courseId: oid(),
      step: 'tts',
      logs: [{ level: 'debug', msg: 'x' }],
    });
    expect(doc.validateSync()?.errors['logs.0.level']).toBeDefined();
  });
});

describe('Deployment', () => {
  it('accepte un déploiement valide avec défauts', () => {
    const doc = new Deployment({
      courseId: oid(),
      userId: oid(),
      platform: 'udemy',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('pending');
    expect(doc.mode).toBe('auto');
    expect(doc.checkpoint.lessonIndex).toBe(0);
  });

  it('rejette un mode inconnu', () => {
    const doc = new Deployment({
      courseId: oid(),
      userId: oid(),
      platform: 'udemy',
      mode: 'yolo',
    });
    expect(doc.validateSync()?.errors['mode']).toBeDefined();
  });
});
