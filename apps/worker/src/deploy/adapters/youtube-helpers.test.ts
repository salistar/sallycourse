// Tests de la logique PURE de l'adapter YouTube (aucun réseau) :
// timestamps/chapitres, description, tags, découpage de quota.
import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  buildChapters,
  chaptersFromSections,
  sanitizeTags,
  buildLessonTitle,
  buildLessonDescription,
  lessonQuotaCost,
  lessonsPerQuotaWindow,
  splitByQuota,
  YT_QUOTA,
  type Chapter,
} from './youtube-helpers.js';
import type { ILesson, ISection } from '../../shared.js';

describe('formatTimestamp', () => {
  it('formate M:SS sous une heure', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(600)).toBe('10:00');
  });
  it('formate H:MM:SS au-delà d’une heure', () => {
    expect(formatTimestamp(3661)).toBe('1:01:01');
    expect(formatTimestamp(7325)).toBe('2:02:05');
  });
  it('borne les négatifs à 0', () => {
    expect(formatTimestamp(-42)).toBe('0:00');
  });
});

describe('buildChapters', () => {
  it('retourne vide avec moins de 2 chapitres (règle YouTube)', () => {
    expect(buildChapters([])).toBe('');
    expect(buildChapters([{ offsetSec: 0, label: 'Intro' }])).toBe('');
  });

  it('force le premier chapitre à 0:00 même si l’offset fourni est non nul', () => {
    const out = buildChapters([
      { offsetSec: 30, label: 'Intro' },
      { offsetSec: 120, label: 'Partie 2' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('0:00 Intro');
    expect(lines[1]).toBe('2:00 Partie 2');
  });
});

describe('chaptersFromSections', () => {
  const mk = (id: string, order: number, title: string): ISection =>
    ({ _id: id, order, title, courseId: 'c' } as unknown as ISection);
  const lesson = (sectionId: string, order: number, durationMin: number): ILesson =>
    ({ sectionId, order, durationMin, title: `L${order}` } as unknown as ILesson);

  it('cumule les durées des leçons pour situer chaque section', () => {
    const sections = [mk('s1', 0, 'Section A'), mk('s2', 1, 'Section B')];
    const lessons = [
      lesson('s1', 0, 5),
      lesson('s1', 1, 10),
      lesson('s2', 0, 3),
    ];
    const chapters = chaptersFromSections(sections, lessons);
    expect(chapters).toEqual([
      { offsetSec: 0, label: 'Section A' },
      { offsetSec: 900, label: 'Section B' }, // 5 + 10 min = 900 s
    ]);
  });

  it('trie les sections par ordre', () => {
    const sections = [mk('s2', 1, 'B'), mk('s1', 0, 'A')];
    const chapters = chaptersFromSections(sections, [lesson('s1', 0, 2)]);
    expect(chapters[0]?.label).toBe('A');
    expect(chapters[1]?.label).toBe('B');
  });
});

describe('sanitizeTags', () => {
  it('déduplique (insensible à la casse), nettoie et borne', () => {
    expect(sanitizeTags(['CSS', 'css', '  Flexbox ', ''])).toEqual(['CSS', 'Flexbox']);
  });
  it('retire les chevrons et tronque à 60 caractères', () => {
    const [tag] = sanitizeTags(['a<b>c']);
    expect(tag).toBe('abc');
  });
  it('respecte le plafond cumulé de 500 caractères', () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag-de-vingt-caract-${i}`.padEnd(20, 'x'));
    const total = sanitizeTags(many).join('').length;
    expect(total).toBeLessThanOrEqual(500);
  });
});

describe('buildLessonTitle', () => {
  it('préfixe un numéro 1-based sur 2 chiffres', () => {
    expect(buildLessonTitle(0, 'Introduction')).toBe('01 · Introduction');
    expect(buildLessonTitle(11, 'Suite')).toBe('12 · Suite');
  });
  it('borne à 100 caractères avec ellipse', () => {
    const title = buildLessonTitle(0, 'x'.repeat(200));
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('buildLessonDescription', () => {
  it('assemble accroche, position, résumé et chapitres', () => {
    const chapters: Chapter[] = [
      { offsetSec: 0, label: 'Intro' },
      { offsetSec: 60, label: 'Coeur' },
    ];
    const desc = buildLessonDescription({
      courseTitle: 'Le cours',
      lessonTitle: 'La leçon',
      index: 2,
      total: 5,
      summary: 'Un résumé.',
      chapters,
      brandLine: 'SALISTAR',
    });
    expect(desc).toContain('La leçon');
    expect(desc).toContain('Leçon 3 / 5 — Le cours');
    expect(desc).toContain('Un résumé.');
    expect(desc).toContain('Chapitres :');
    expect(desc).toContain('0:00 Intro');
    expect(desc).toContain('1:00 Coeur');
    expect(desc.endsWith('SALISTAR')).toBe(true);
  });

  it('omet le bloc chapitres si moins de 2 entrées', () => {
    const desc = buildLessonDescription({
      courseTitle: 'C',
      lessonTitle: 'L',
      index: 0,
      total: 1,
      chapters: [{ offsetSec: 0, label: 'Seul' }],
    });
    expect(desc).not.toContain('Chapitres :');
  });

  it('borne la description à 5000 caractères', () => {
    const desc = buildLessonDescription({
      courseTitle: 'C',
      lessonTitle: 'L',
      index: 0,
      total: 1,
      summary: 'x'.repeat(9000),
    });
    expect(desc.length).toBeLessThanOrEqual(5000);
  });
});

describe('quota', () => {
  it('coût par leçon = vidéo + item playlist (+ caption + miniature)', () => {
    expect(lessonQuotaCost({ withCaption: false, withThumbnail: false })).toBe(
      YT_QUOTA.videoInsert + YT_QUOTA.playlistItemInsert,
    );
    expect(lessonQuotaCost({ withCaption: true, withThumbnail: true })).toBe(
      YT_QUOTA.videoInsert +
        YT_QUOTA.playlistItemInsert +
        YT_QUOTA.captionInsert +
        YT_QUOTA.thumbnailSet,
    );
  });

  it('leçons par fenêtre : réserve le coût de la playlist', () => {
    // Coût complet = 1600 + 50 + 400 + 50 = 2100 ; budget = 10000 - 50 = 9950.
    const cost = lessonQuotaCost({ withCaption: true, withThumbnail: true });
    expect(lessonsPerQuotaWindow(cost)).toBe(Math.floor((10_000 - 50) / cost)); // = 4
  });

  it('leçons par fenêtre = 0 si une leçon dépasse le budget', () => {
    expect(lessonsPerQuotaWindow(20_000)).toBe(0);
  });

  it('découpe le total en lots quotidiens', () => {
    expect(splitByQuota(10, 4)).toEqual([4, 4, 2]);
    expect(splitByQuota(0, 4)).toEqual([]);
  });

  it('rejette un perDay non positif', () => {
    expect(() => splitByQuota(5, 0)).toThrow();
  });
});
