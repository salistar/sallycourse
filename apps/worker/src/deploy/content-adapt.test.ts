// Tests de la logique PURE d'adaptation du contenu par plateforme (Prompt 45).
// Aucun appel réseau : adaptForPlatform est pur ; reformulateDescriptions est
// testé en mode mock (MOCK_PROVIDERS) avec reformulation locale déterministe.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adaptForPlatform,
  groupLessonsByDuration,
  reformulateDescriptions,
  mockReformulate,
  YOUTUBE_MIN_VIDEO_MIN,
  type UploadPlan,
} from './content-adapt.js';
import { resetConfigCache } from '../shared.js';
import type { ICourse, ILesson, LessonType } from '../shared.js';

// ── Fabriques de test ────────────────────────────────────────────
function course(title = 'Maîtriser TypeScript'): ICourse {
  return { title } as unknown as ICourse;
}

function lesson(partial: {
  title: string;
  type?: LessonType;
  durationMin?: number;
  summary?: string;
}): ILesson {
  return {
    title: partial.title,
    type: partial.type ?? 'video',
    durationMin: partial.durationMin,
    summary: partial.summary,
    assets: {},
  } as unknown as ILesson;
}

/** Cours de N leçons vidéo de `min` minutes chacune. */
function lessons(n: number, min: number, type: LessonType = 'video'): ILesson[] {
  return Array.from({ length: n }, (_, i) =>
    lesson({ title: `Leçon ${i + 1}`, type, durationMin: min, summary: `Résumé ${i + 1}` }),
  );
}

// ── groupLessonsByDuration ───────────────────────────────────────
describe('groupLessonsByDuration', () => {
  it('regroupe les leçons courtes jusqu’à atteindre la cible (10 min)', () => {
    // 6 leçons de 3 min → groupes de 4 (12 min) puis reliquat 2 leçons (6 min)
    // fusionné au précédent car < 10.
    const groups = groupLessonsByDuration(lessons(6, 3), 10);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('ferme un groupe dès que la cible est atteinte', () => {
    // 4 leçons de 5 min → groupe de 2 (10 min), groupe de 2 (10 min).
    const groups = groupLessonsByDuration(lessons(4, 5), 10);
    expect(groups).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('garde une leçon seule si elle dépasse déjà la cible', () => {
    const groups = groupLessonsByDuration(lessons(2, 12), 10);
    expect(groups).toEqual([[0], [1]]);
  });

  it('fusionne le reliquat trop court au dernier groupe', () => {
    // 3 leçons de 5 min : [0,1]=10min ferme, reliquat [2]=5min<10 → fusion.
    const groups = groupLessonsByDuration(lessons(3, 5), 10);
    expect(groups).toEqual([[0, 1, 2]]);
  });

  it('conserve un unique groupe court si c’est la seule leçon', () => {
    expect(groupLessonsByDuration(lessons(1, 2), 10)).toEqual([[0]]);
  });

  it('retourne [] pour un cours vide', () => {
    expect(groupLessonsByDuration([], 10)).toEqual([]);
  });

  it('traite une durée absente comme la valeur par défaut (5 min)', () => {
    const ls = [lesson({ title: 'A' }), lesson({ title: 'B' })]; // 5 + 5 = 10
    expect(groupLessonsByDuration(ls, 10)).toEqual([[0, 1]]);
  });
});

// ── Udemy : per-lesson, structure telle quelle ───────────────────
describe('adaptForPlatform — udemy', () => {
  it('produit une unité par leçon en conservant le type d’origine', () => {
    const ls = [
      lesson({ title: 'Intro', type: 'video', durationMin: 4 }),
      lesson({ title: 'Mémo', type: 'article', durationMin: 3 }),
      lesson({ title: 'TP', type: 'tp', durationMin: 8 }),
    ];
    const plan = adaptForPlatform('udemy', course(), ls);
    expect(plan.strategy).toBe('per-lesson');
    expect(plan.units).toHaveLength(3);
    expect(plan.units.map((u) => u.format)).toEqual(['video', 'article', 'article']);
    expect(plan.units[0]!.lessonIndices).toEqual([0]);
    expect(plan.totalLessons).toBe(3);
  });
});

// ── YouTube : vidéos groupées 10min+ avec chapitres ──────────────
describe('adaptForPlatform — youtube', () => {
  it('regroupe les leçons courtes et génère des chapitres', () => {
    const plan = adaptForPlatform('youtube', course(), lessons(4, 5)); // 2 groupes de 2
    expect(plan.strategy).toBe('grouped-video');
    expect(plan.units).toHaveLength(2);
    for (const u of plan.units) {
      expect(u.format).toBe('video');
      expect(u.durationMin).toBe(10);
      expect(u.lessonIndices).toHaveLength(2);
      // Chapitres : premier à 0, second à 5 min (300 s).
      expect(u.chapters).toHaveLength(2);
      expect(u.chapters[0]!.offsetSec).toBe(0);
      expect(u.chapters[1]!.offsetSec).toBe(300);
    }
  });

  it('n’émet pas de chapitres pour une unité mono-leçon', () => {
    const plan = adaptForPlatform('youtube', course(), lessons(1, 15));
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.chapters).toEqual([]);
    expect(plan.units[0]!.lessonIndices).toEqual([0]);
  });

  it('couvre toutes les leçons d’origine (aucune perte)', () => {
    const plan = adaptForPlatform('youtube', course(), lessons(7, 3));
    const covered = plan.units.flatMap((u) => u.lessonIndices).sort((a, b) => a - b);
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('titre groupé indique le nombre de leçons couvertes', () => {
    const plan = adaptForPlatform('youtube', course(), lessons(4, 5));
    expect(plan.units[0]!.title).toContain('(+1)');
  });
});

// ── Skillshare : tout en vidéo ───────────────────────────────────
describe('adaptForPlatform — skillshare', () => {
  it('convertit chaque leçon (même article/tp) en unité vidéo', () => {
    const ls = [
      lesson({ title: 'A', type: 'article' }),
      lesson({ title: 'B', type: 'tp' }),
      lesson({ title: 'C', type: 'quiz' }),
    ];
    const plan = adaptForPlatform('skillshare', course(), ls);
    expect(plan.strategy).toBe('all-video');
    expect(plan.units).toHaveLength(3);
    expect(plan.units.every((u) => u.format === 'video')).toBe(true);
  });
});

// ── Gumroad : un unique ZIP ──────────────────────────────────────
describe('adaptForPlatform — gumroad', () => {
  it('empaquette tout le cours dans une seule unité ZIP', () => {
    const plan = adaptForPlatform('gumroad', course('Pack Data'), lessons(5, 4));
    expect(plan.strategy).toBe('single-zip');
    expect(plan.units).toHaveLength(1);
    const unit = plan.units[0]!;
    expect(unit.format).toBe('zip');
    expect(unit.title).toBe('Pack Data');
    expect(unit.lessonIndices).toEqual([0, 1, 2, 3, 4]);
    expect(unit.durationMin).toBe(20);
    expect(unit.chapters).toHaveLength(5);
  });

  it('ne produit aucune unité pour un cours vide', () => {
    const plan = adaptForPlatform('gumroad', course(), []);
    expect(plan.units).toEqual([]);
    expect(plan.totalLessons).toBe(0);
  });
});

// ── Plateforme inconnue : fallback per-lesson sûr ────────────────
describe('adaptForPlatform — inconnue', () => {
  it('retombe sur per-lesson', () => {
    const plan = adaptForPlatform('inconnue', course(), lessons(2, 5));
    expect(plan.strategy).toBe('per-lesson');
    expect(plan.units).toHaveLength(2);
  });
});

// ── reformulateDescriptions (mode mock) ──────────────────────────
describe('reformulateDescriptions (mock)', () => {
  beforeEach(() => {
    // Config minimale valide + court-circuit providers (aucun appel réseau).
    Object.assign(process.env, {
      APP_URL: 'http://localhost:3000',
      MONGO_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      S3_BUCKET: 'test',
      S3_REGION: 'us-east-1',
      AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
      CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
      MOCK_PROVIDERS: 'true',
    });
    resetConfigCache();
  });
  afterEach(() => resetConfigCache());

  it('préfixe chaque description par le ton mock de la plateforme', async () => {
    const plan = adaptForPlatform('youtube', course(), lessons(2, 8));
    const out = await reformulateDescriptions(plan);
    for (const u of out.units) {
      expect(u.description.startsWith('[mock:youtube]')).toBe(true);
    }
  });

  it('ne modifie pas un plan sans unités', async () => {
    const empty: UploadPlan = {
      platform: 'gumroad',
      strategy: 'single-zip',
      units: [],
      totalLessons: 0,
    };
    const out = await reformulateDescriptions(empty);
    expect(out).toBe(empty);
  });

  it('mockReformulate est déterministe et étiqueté', () => {
    expect(mockReformulate('Udemy', 'Bonjour')).toBe('[mock:udemy] Bonjour');
  });
});

// ── Constante exportée ───────────────────────────────────────────
describe('YOUTUBE_MIN_VIDEO_MIN', () => {
  it('vaut 10 minutes', () => {
    expect(YOUTUBE_MIN_VIDEO_MIN).toBe(10);
  });
});
