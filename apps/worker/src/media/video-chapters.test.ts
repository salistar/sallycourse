// Tests des helpers PURS de chapitrage vidéo (Prompt 136) : construction du
// fichier FFMETADATA1, dérivation des chapitres depuis segments/script, et
// slide "table des matières" (gabarit recap réutilisé).
import { describe, expect, it } from 'vitest';
import {
  buildFfmetadataChapters,
  buildChapterMuxArgs,
  buildTocSlideInput,
  chaptersFromSegments,
  escapeFfmetadata,
  lessonChaptersFromScript,
  TOC_MAX_ITEMS,
} from './video-chapters.js';

describe('escapeFfmetadata', () => {
  it("échappe les caractères spéciaux FFMETADATA1", () => {
    expect(escapeFfmetadata('Titre = spécial; #1')).toBe('Titre \\= spécial\\; \\#1');
  });

  it('échappe les antislashs et retours à la ligne', () => {
    expect(escapeFfmetadata('a\\b\nc')).toBe('a\\\\b\\\nc');
  });

  it('laisse un texte simple inchangé', () => {
    expect(escapeFfmetadata('Introduction')).toBe('Introduction');
  });
});

describe('chaptersFromSegments', () => {
  it('ignore les segments sans titre (prolongent le chapitre courant)', () => {
    const chapters = chaptersFromSegments([
      { seconds: 3, title: 'Intro' },
      { seconds: 10 }, // slide sans titre qualifiant
      { seconds: 8, title: 'Section 2' },
    ]);
    expect(chapters).toEqual([
      { offsetSec: 0, title: 'Intro' },
      { offsetSec: 13, title: 'Section 2' },
    ]);
  });

  it('retourne [] si aucun segment titré', () => {
    expect(chaptersFromSegments([{ seconds: 5 }, { seconds: 5 }])).toEqual([]);
  });

  it('force le premier chapitre à 0:00 même si le premier segment titré est décalé', () => {
    const chapters = chaptersFromSegments([{ seconds: 4 }, { seconds: 6, title: 'Premier' }]);
    expect(chapters[0]).toEqual({ offsetSec: 0, title: 'Premier' });
  });
});

describe('buildFfmetadataChapters', () => {
  it('retourne "" si aucun chapitre', () => {
    expect(buildFfmetadataChapters([], 60)).toBe('');
  });

  it('génère un bloc FFMETADATA1 valide avec START/END en millisecondes', () => {
    const out = buildFfmetadataChapters(
      [
        { offsetSec: 0, title: 'Introduction' },
        { offsetSec: 30, title: 'Section 2' },
      ],
      90,
    );
    expect(out.startsWith(';FFMETADATA1\n')).toBe(true);
    expect(out).toContain('[CHAPTER]');
    expect(out).toContain('TIMEBASE=1/1000');
    expect(out).toContain('START=0');
    expect(out).toContain('END=30000');
    expect(out).toContain('title=Introduction');
    expect(out).toContain('START=30000');
    expect(out).toContain('END=90000');
    expect(out).toContain('title=Section 2');
  });

  it('trie les chapitres par offset même donnés dans le désordre', () => {
    const out = buildFfmetadataChapters(
      [
        { offsetSec: 20, title: 'Deuxième' },
        { offsetSec: 0, title: 'Premier' },
      ],
      40,
    );
    const firstIdx = out.indexOf('title=Premier');
    const secondIdx = out.indexOf('title=Deuxième');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('échappe les titres contenant des caractères spéciaux', () => {
    const out = buildFfmetadataChapters([{ offsetSec: 0, title: 'Q&R ; astuces' }], 10);
    expect(out).toContain('title=Q&R \\; astuces');
  });
});

describe('buildChapterMuxArgs', () => {
  it('construit les arguments ffmpeg -map_metadata -c copy', () => {
    const args = buildChapterMuxArgs('in.mp4', 'chapters.ffmetadata', 'out.mp4');
    expect(args).toEqual([
      '-y',
      '-i',
      'in.mp4',
      '-i',
      'chapters.ffmetadata',
      '-map_metadata',
      '1',
      '-map_chapters',
      '1',
      '-c',
      'copy',
      'out.mp4',
    ]);
  });
});

describe('lessonChaptersFromScript', () => {
  it('ouvre un chapitre sur les slides title/section-transition uniquement', () => {
    const slides = [
      { template: 'title', title: 'Introduction', audioSeconds: 10 },
      { template: 'content', title: 'Point 1', audioSeconds: 20 },
      { template: 'section-transition', title: 'Partie 2', audioSeconds: 5 },
      { template: 'recap', title: 'Résumé', audioSeconds: 8 },
    ] as const;
    const chapters = lessonChaptersFromScript(slides, 3);
    expect(chapters).toEqual([
      { offsetSec: 0, title: 'Introduction' },
      { offsetSec: 3 + 10 + 20, title: 'Partie 2' },
    ]);
  });

  it('retourne [] si aucune slide ne qualifie', () => {
    const slides = [{ template: 'content', title: 'X', audioSeconds: 5 }] as const;
    expect(lessonChaptersFromScript(slides)).toEqual([]);
  });

  it('traite audioSeconds manquant comme 0 (pas de décalage)', () => {
    const slides = [{ template: 'title', title: 'Intro' }] as const;
    expect(lessonChaptersFromScript(slides)).toEqual([{ offsetSec: 0, title: 'Intro' }]);
  });
});

describe('buildTocSlideInput', () => {
  it('liste les sections telles quelles si <= TOC_MAX_ITEMS', () => {
    const input = buildTocSlideInput({
      courseTitle: 'Mon cours',
      sectionTitles: ['Section A', 'Section B'],
    });
    expect(input.items).toEqual(['Section A', 'Section B']);
    expect(input.title).toBe('Au programme de ce cours');
    expect(input.courseTitle).toBe('Mon cours');
  });

  it('regroupe les sections excédentaires au-delà de TOC_MAX_ITEMS', () => {
    const sectionTitles = Array.from({ length: TOC_MAX_ITEMS + 3 }, (_, i) => `Section ${i + 1}`);
    const input = buildTocSlideInput({ courseTitle: 'Cours long', sectionTitles });
    expect(input.items).toHaveLength(TOC_MAX_ITEMS);
    expect(input.items[TOC_MAX_ITEMS - 1]).toBe('+ 4 sections supplémentaires');
  });

  it('retombe sur un item par défaut si aucune section', () => {
    const input = buildTocSlideInput({ courseTitle: 'Cours vide', sectionTitles: [] });
    expect(input.items).toEqual(['Programme en cours de préparation']);
  });
});
