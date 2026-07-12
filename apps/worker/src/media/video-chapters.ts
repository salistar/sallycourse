// Table des matières et chapitrage (Prompt 136).
//
// Trois usages du même concept « liste de chapitres horodatés » :
//   1. métadonnées FFmpeg (FFMETADATA1) injectées au MUX final d'une leçon —
//      chaque slide/section devient un [CHAPTER] cliquable dans les lecteurs
//      qui savent lire les chapitres MP4 (VLC, QuickTime, la plupart des
//      lecteurs web) ;
//   2. description YouTube : liste de lignes "HH:MM:SS Titre" — YouTube
//      détecte automatiquement ce format et affiche les chapitres sous la
//      vidéo (cf. deploy/adapters/youtube-helpers.ts::buildChapters, qui
//      couvre déjà ce format pour la playlist — on l'étend ici à CHAQUE
//      leçon, avec ses propres slides) ;
//   3. sommaire interactif en tête de la PREMIÈRE vidéo du cours : une slide
//      "table des matières" optionnelle (gabarit D7 "recap" réutilisé tel
//      quel — la checklist devient une liste de sections).
//
// Tout est PUR : aucune I/O ici (le fichier de metadata est écrit par
// l'appelant dans video-render.ts, aux côtés du reste du montage temporaire).

import type { SlideTemplateInput, Slide } from '../shared.js';

/* ------------------------------------------------------------------ */
/* Chapitre générique (offset + titre)                                 */
/* ------------------------------------------------------------------ */

/** Un chapitre horodaté : offset depuis le début de la vidéo (secondes) + titre. */
export interface VideoChapter {
  offsetSec: number;
  title: string;
}

/**
 * Dérive la liste des chapitres d'UNE leçon à partir de son plan de segments
 * (VideoSegment de video-render.ts, mais on ne dépend pas du type exact pour
 * rester découplé — juste `seconds` + un titre optionnel par segment). Un
 * segment sans titre (silencieux, avatar…) n'ouvre PAS de nouveau chapitre :
 * il prolonge le chapitre courant. Le premier segment titré démarre toujours
 * à 0s (contrainte FFMETADATA1/YouTube).
 */
export function chaptersFromSegments(
  segments: readonly { seconds: number; title?: string }[],
): VideoChapter[] {
  const chapters: VideoChapter[] = [];
  let cumulativeSec = 0;
  for (const segment of segments) {
    if (segment.title?.trim()) {
      chapters.push({ offsetSec: cumulativeSec, title: segment.title.trim() });
    }
    cumulativeSec += Math.max(0, segment.seconds);
  }
  // Force le premier chapitre à 0:00 (règle FFMETADATA1/YouTube commune).
  if (chapters.length > 0 && chapters[0]!.offsetSec !== 0) {
    chapters[0] = { ...chapters[0]!, offsetSec: 0 };
  }
  return chapters;
}

/* ------------------------------------------------------------------ */
/* FFMETADATA1 (pur)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Échappe les caractères spéciaux du format FFMETADATA1 (`=`, `;`, `#`,
 * `\`, retour à la ligne) — cf. doc ffmpeg « Metadata subsystem ».
 */
export function escapeFfmetadata(value: string): string {
  return value.replace(/[\\=;#\n]/g, (ch) => `\\${ch}`);
}

/**
 * Construit le contenu d'un fichier FFMETADATA1 décrivant des chapitres.
 * `timebase` est le dénominateur des unités START/END (1000 = millisecondes,
 * défaut) : ffmpeg exige START/END en entiers de cette unité. Le dernier
 * chapitre s'étend jusqu'à `totalDurationSec` (durée totale du montage).
 * Retourne '' si `chapters` est vide (rien à injecter — appelant doit alors
 * sauter cette étape, comportement historique inchangé).
 */
export function buildFfmetadataChapters(
  chapters: readonly VideoChapter[],
  totalDurationSec: number,
  timebase = 1000,
): string {
  if (chapters.length === 0) return '';

  const sorted = [...chapters].sort((a, b) => a.offsetSec - b.offsetSec);
  const lines: string[] = [';FFMETADATA1'];

  sorted.forEach((chapter, i) => {
    const startSec = Math.max(0, chapter.offsetSec);
    const endSec = i + 1 < sorted.length ? sorted[i + 1]!.offsetSec : Math.max(startSec, totalDurationSec);
    lines.push(
      '[CHAPTER]',
      `TIMEBASE=1/${timebase}`,
      `START=${Math.round(startSec * timebase)}`,
      `END=${Math.round(endSec * timebase)}`,
      `title=${escapeFfmetadata(chapter.title)}`,
    );
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Arguments ffmpeg pour injecter un fichier de metadata (chapitres) dans un
 * MP4 déjà encodé, SANS réencodage (-c copy). `input` est le MP4 source
 * (montage sans chapitres), `metadataPath` le fichier FFMETADATA1 à fusionner,
 * `output` la destination finale. Utilisé en étape additionnelle après le
 * concat demuxer existant — si `metadataPath` est absent/vide côté appelant,
 * cette étape est simplement sautée (aucun changement pour les vidéos qui
 * n'ont pas de chapitres).
 */
export function buildChapterMuxArgs(input: string, metadataPath: string, output: string): string[] {
  return [
    '-y',
    '-i',
    input,
    '-i',
    metadataPath,
    '-map_metadata',
    '1',
    '-map_chapters',
    '1',
    '-c',
    'copy',
    output,
  ];
}

/* ------------------------------------------------------------------ */
/* Slide "table des matières" (réutilise le gabarit D7 "recap")         */
/* ------------------------------------------------------------------ */

/** Nombre maximal de sections affichables sur une slide recap (contrainte du gabarit). */
export const TOC_MAX_ITEMS = 6;

/**
 * Construit les données d'entrée du gabarit "recap" (render-templates)
 * utilisées comme sommaire interactif de début de cours : chaque item liste
 * une section. Réutilise TEL QUEL le gabarit D7 existant — pas de nouveau
 * fichier HTML nécessaire (contrairement au TOC PDF). Tronque à TOC_MAX_ITEMS
 * (limite du gabarit recap) : les sections excédentaires sont regroupées
 * dans un dernier item "+ N sections supplémentaires".
 */
export function buildTocSlideInput(params: {
  courseTitle: string;
  sectionTitles: readonly string[];
  lang?: string;
  direction?: 'ltr' | 'rtl';
}): SlideTemplateInput['recap'] {
  const { courseTitle, sectionTitles, lang, direction } = params;
  const items =
    sectionTitles.length <= TOC_MAX_ITEMS
      ? sectionTitles.slice()
      : [
          ...sectionTitles.slice(0, TOC_MAX_ITEMS - 1),
          `+ ${sectionTitles.length - (TOC_MAX_ITEMS - 1)} sections supplémentaires`,
        ];

  return {
    ...(lang ? { lang } : {}),
    ...(direction ? { direction } : {}),
    courseTitle,
    progress: 0,
    lessonLabel: 'Sommaire',
    lessonNumber: '—',
    title: 'Au programme de ce cours',
    items: items.length > 0 ? items : ['Programme en cours de préparation'],
  };
}

/* ------------------------------------------------------------------ */
/* Chapitres d'UNE leçon dérivés de son SlideScript (pur)               */
/* ------------------------------------------------------------------ */

/**
 * Dérive les chapitres d'UNE leçon vidéo à partir de son script de slides :
 * chaque slide de template "title" ou "section-transition" démarre un
 * nouveau chapitre (les autres templates prolongent le chapitre courant —
 * une slide "content"/"code"/"quote" isolée n'a pas vocation à apparaître
 * dans la table des matières). `introSeconds` décale tous les offsets du
 * segment d'intro (carte titre) placé en tête du montage (cf. VIDEO.INTRO_SECONDS
 * dans video-render.ts). Retourne [] si aucune slide ne qualifie (repli :
 * pas de chapitres, comportement historique inchangé).
 */
export function lessonChaptersFromScript(
  slides: readonly Pick<Slide, 'template' | 'title' | 'audioSeconds'>[],
  introSeconds = 0,
): VideoChapter[] {
  const CHAPTER_TEMPLATES = new Set(['title', 'section-transition']);
  const chapters: VideoChapter[] = [];
  let cumulativeSec = Math.max(0, introSeconds);
  for (const slide of slides) {
    if (CHAPTER_TEMPLATES.has(slide.template)) {
      chapters.push({ offsetSec: cumulativeSec, title: slide.title.trim() });
    }
    cumulativeSec += Math.max(0, slide.audioSeconds ?? 0);
  }
  if (chapters.length > 0 && chapters[0]!.offsetSec !== 0) {
    chapters[0] = { ...chapters[0]!, offsetSec: 0 };
  }
  return chapters;
}

/* ------------------------------------------------------------------ */
/* Timestamps YouTube (délégué — cf. youtube-helpers.ts)                */
/* ------------------------------------------------------------------ */
// NOTE : le formatage HH:MM:SS / M:SS et la construction du bloc "Chapitres :"
// de la description YouTube vivent déjà dans
// apps/worker/src/deploy/adapters/youtube-helpers.ts (formatTimestamp,
// buildChapters, chaptersFromSections) — réutilisés tels quels par
// deploy/adapters/youtube.ts pour la description de CHAQUE leçon (voir
// buildLessonChapters ci-dessous, qui adapte chaptersFromSegments/VideoChapter
// vers le type Chapter attendu par buildChapters).
