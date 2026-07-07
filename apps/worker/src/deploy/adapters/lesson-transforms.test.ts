// Tests de la logique PURE partagée par les adapters Podia/Gumroad/Skillshare.
// Aucun appel réseau/navigateur/DB.
import { describe, expect, it } from 'vitest';
import {
  articleToResource,
  buildProductDescription,
  isVideoLesson,
  partitionLessons,
  selectMainTp,
  slugifyTitle,
} from './lesson-transforms.js';
import type { ICourse, ILesson } from '../../shared.js';

/** Fabrique de leçon minimale (champs non lus laissés vides). */
function lesson(partial: Partial<ILesson>): ILesson {
  return {
    title: 'Leçon',
    type: 'article',
    order: 0,
    assets: { screenshots: [], slides: [] },
    ...partial,
  } as unknown as ILesson;
}

describe('slugifyTitle', () => {
  it('minuscule, retire accents et compacte', () => {
    expect(slugifyTitle('Créer une API — Débutant')).toBe('creer-une-api-debutant');
  });

  it('retombe sur « lecon » quand rien ne subsiste', () => {
    expect(slugifyTitle('***')).toBe('lecon');
    expect(slugifyTitle('')).toBe('lecon');
  });
});

describe('isVideoLesson', () => {
  it('vrai seulement si type video ET asset vidéo présent', () => {
    expect(isVideoLesson(lesson({ type: 'video', assets: { videoUrl: 'k', screenshots: [], slides: [] } as never }))).toBe(true);
    expect(isVideoLesson(lesson({ type: 'video' }))).toBe(false); // pas d'asset
    expect(isVideoLesson(lesson({ type: 'article' }))).toBe(false);
  });
});

describe('articleToResource', () => {
  it('article → ressource .md avec nom de fichier indexé', () => {
    const res = articleToResource(lesson({ title: 'Les bases du DOM', type: 'article' }), 2, 'corps');
    expect(res.filename).toBe('03-les-bases-du-dom.md');
    expect(res.kind).toBe('article');
    expect(res.body).toBe('corps');
    expect(res.index).toBe(2);
  });

  it('quiz → ressource .txt', () => {
    const res = articleToResource(lesson({ title: 'Quiz', type: 'quiz' }), 0);
    expect(res.filename).toBe('01-quiz.txt');
  });
});

describe('selectMainTp', () => {
  it('choisit le TP le plus long', () => {
    const lessons = [
      lesson({ title: 'TP court', type: 'tp', durationMin: 10 }),
      lesson({ title: 'Article', type: 'article' }),
      lesson({ title: 'TP long', type: 'tp', durationMin: 45 }),
    ];
    expect(selectMainTp(lessons)?.title).toBe('TP long');
  });

  it('retourne null sans TP', () => {
    expect(selectMainTp([lesson({ type: 'article' }), lesson({ type: 'video' })])).toBeNull();
  });

  it('premier TP si durées absentes', () => {
    const lessons = [lesson({ title: 'TP A', type: 'tp' }), lesson({ title: 'TP B', type: 'tp' })];
    expect(selectMainTp(lessons)?.title).toBe('TP A');
  });
});

describe('partitionLessons', () => {
  it('sépare vidéos et non-vidéos en conservant les index absolus', () => {
    const lessons = [
      lesson({ type: 'article' }),
      lesson({ type: 'video', assets: { videoUrl: 'k', screenshots: [], slides: [] } as never }),
      lesson({ type: 'tp' }),
    ];
    const { videos, resources } = partitionLessons(lessons);
    expect(videos.map((v) => v.index)).toEqual([1]);
    expect(resources.map((r) => r.index)).toEqual([0, 2]);
  });
});

describe('buildProductDescription', () => {
  const base = { title: 'Node avancé', difficulty: 'advanced' } as unknown as ICourse;

  it('reprend la description marketing si présente', () => {
    const course = { ...base, marketing: { content: { udemyDescription: 'Ma super desc' } } } as unknown as ICourse;
    expect(buildProductDescription(course, 12)).toBe('Ma super desc');
  });

  it('compose un fallback avec titre, niveau et nombre de leçons', () => {
    const desc = buildProductDescription(base, 8);
    expect(desc).toContain('Node avancé');
    expect(desc).toContain('advanced');
    expect(desc).toContain('8 leçon');
  });
});
