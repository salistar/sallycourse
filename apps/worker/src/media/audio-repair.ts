// Diagnostic et réparation audio par leçon (Lot 2, plan 2026-07-20) : bouton
// « Réparer l'audio » — détecte les trous de silence RÉELLEMENT internes à une
// slide (pas une transition normale entre deux slides) dans la vidéo FINALE
// déjà rendue, pour ne re-synthétiser QUE les slides fautives plutôt que tout
// le cours. Toute la logique d'attribution est PURE et testable sans ffmpeg ;
// seule la détection brute des trous (silencedetect) et la re-synthèse sont
// de l'I/O, orchestrées par le processor associé (processors/audio-repair.ts).
import { VIDEO } from '../shared.js';

/** Un silence détecté dans la piste audio finale (secondes, bornes incluses). */
export interface SilenceGap {
  start: number;
  end: number;
}

/** Plage temporelle occupée par la narration d'une slide dans la vidéo finale. */
export interface SlideAudioRange {
  index: number;
  start: number;
  end: number;
}

/**
 * Reconstruit la plage temporelle de chaque slide dans la piste audio finale.
 * Reproduit EXACTEMENT la formule de `buildLessonAudioArgs`/`lessonChaptersFromScript`
 * (video-render.ts / video-chapters.ts) : les segments sont concaténés bout à
 * bout SANS aucun gap — un simple cumul de `audioSeconds`, décalé par la durée
 * de l'intro. Simplification assumée : n'intègre PAS le segment avatar
 * optionnel de la première leçon d'une section (AVATAR.SEGMENT_SECONDS) — un
 * cours avec avatar activé sur sa toute première leçon peut donc voir ses
 * tout premiers offsets légèrement décalés ; n'affecte pas l'attribution des
 * slides suivantes (le décalage est constant, pas cumulatif).
 */
export function computeSlideAudioRanges(
  slides: readonly { audioSeconds?: number }[],
  introSeconds: number = VIDEO.INTRO_SECONDS,
): SlideAudioRange[] {
  const ranges: SlideAudioRange[] = [];
  let cursor = Math.max(0, introSeconds);
  slides.forEach((slide, index) => {
    const duration = Math.max(0, slide.audioSeconds ?? 0);
    ranges.push({ index, start: cursor, end: cursor + duration });
    cursor += duration;
  });
  return ranges;
}

/**
 * Parse la sortie stderr d'un `ffmpeg -af silencedetect=noise=…:d=…` : extrait
 * les paires `silence_start`/`silence_end` en secondes. Un `silence_start`
 * sans `silence_end` correspondant (silence courant jusqu'à la fin du flux)
 * est ignoré — cas dégénéré (piste qui se termine en silence), hors périmètre
 * du diagnostic (on cherche des trous EN PLEIN MILIEU d'une narration).
 */
export function parseSilenceDetect(stderr: string): SilenceGap[] {
  const starts: number[] = [];
  const gaps: SilenceGap[] = [];
  const startRe = /silence_start:\s*(-?[\d.]+)/g;
  const endRe = /silence_end:\s*(-?[\d.]+)/g;
  // ffmpeg imprime start/end en alternance dans l'ordre chronologique du flux —
  // on les extrait indépendamment puis on les apparie dans l'ordre d'apparition
  // (repli sûr : un start orphelin en fin de sortie est simplement écarté).
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr))) starts.push(Number.parseFloat(m[1]!));
  const ends: number[] = [];
  while ((m = endRe.exec(stderr))) ends.push(Number.parseFloat(m[1]!));
  for (let i = 0; i < Math.min(starts.length, ends.length); i += 1) {
    const start = starts[i]!;
    const end = ends[i]!;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) gaps.push({ start, end });
  }
  return gaps;
}

/** Marge (secondes) sous laquelle un trou touchant une frontière de slide est considéré une transition normale, pas un défaut. */
export const BOUNDARY_MARGIN_SECONDS = 0.3;

/**
 * Attribue chaque trou de silence à la (ou les) slide(s) dont il occupe
 * l'INTÉRIEUR — pas une transition entre deux slides. Reproduit la méthodologie
 * de l'audit manuel 2026-07-20 (cross-référencement trou/frontières de slide) :
 * un trou est un défaut interne SEULEMENT s'il reste à distance (>= marge) des
 * deux bords de la plage de la slide ; un trou qui commence/finit près d'un
 * bord est une pause de transition légitime, pas une dégénérescence TTS.
 * Retourne les index de slides fautives, triés, sans doublon.
 */
export function attributeGapsToSlides(
  gaps: readonly SilenceGap[],
  ranges: readonly SlideAudioRange[],
  marginSeconds: number = BOUNDARY_MARGIN_SECONDS,
): number[] {
  const flagged = new Set<number>();
  for (const gap of gaps) {
    for (const range of ranges) {
      const innerStart = range.start + marginSeconds;
      const innerEnd = range.end - marginSeconds;
      if (innerEnd <= innerStart) continue; // slide trop courte pour avoir un "intérieur" — jamais fautive par cette méthode.
      if (gap.start >= innerStart && gap.end <= innerEnd) {
        flagged.add(range.index);
      }
    }
  }
  return [...flagged].sort((a, b) => a - b);
}
