// Sous-titres (Prompt 25) : primitives PURES et testables du sous-titrage —
// modèle de cue, formatage SRT/VTT, alignement d'une transcription Whisper sur
// le script de narration d'origine, et repli déterministe (découpe du script
// par slide selon la durée de narration estimée) quand Whisper est indisponible.
//
// Ce module ne fait AUCUN I/O : le processor subtitle-generation orchestre le
// téléchargement des médias, l'appel Python et les uploads. On garde ici la
// logique déterministe pour la couvrir par des tests unitaires.
import { AUDIO } from '../shared.js';

/** Un sous-titre : bornes temporelles en secondes + texte affiché. */
export interface Cue {
  /** Début du cue, en secondes (>= 0). */
  start: number;
  /** Fin du cue, en secondes (> start). */
  end: number;
  text: string;
}

/** Segment brut renvoyé par faster-whisper (timestamps en secondes). */
export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Formatage des timestamps
// ---------------------------------------------------------------------------

/** Borne un nombre de secondes à un entier de millisecondes non négatif. */
function toMillis(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

/**
 * Formate un temps (secondes) en `HH:MM:SS,mmm` (SRT) ou `HH:MM:SS.mmm` (VTT)
 * selon le séparateur de millisecondes fourni.
 */
function formatTimestamp(seconds: number, msSeparator: ',' | '.'): string {
  const totalMs = toMillis(seconds);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSeparator}${pad(ms, 3)}`;
}

/** Formate un timestamp SRT (`00:00:01,500`). */
export function formatSrtTimestamp(seconds: number): string {
  return formatTimestamp(seconds, ',');
}

/** Formate un timestamp VTT (`00:00:01.500`). */
export function formatVttTimestamp(seconds: number): string {
  return formatTimestamp(seconds, '.');
}

// ---------------------------------------------------------------------------
// Générateurs de fichiers de sous-titres (purs)
// ---------------------------------------------------------------------------

/** Normalise une liste de cues : ordre chronologique, fins strictement > débuts. */
function normalizeCues(cues: readonly Cue[]): Cue[] {
  return cues
    .map((cue) => ({
      start: Math.max(0, cue.start),
      // Une durée nulle rendrait le cue invisible : on garantit au moins 1 ms.
      end: Math.max(Math.max(0, cue.start) + 0.001, cue.end),
      text: cue.text.trim(),
    }))
    .filter((cue) => cue.text.length > 0)
    .sort((a, b) => a.start - b.start);
}

/** Sérialise des cues au format SRT (index 1-based, ligne vide entre blocs). */
export function toSrt(cues: readonly Cue[]): string {
  const clean = normalizeCues(cues);
  const blocks = clean.map((cue, index) => {
    const time = `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`;
    return `${index + 1}\n${time}\n${cue.text}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

/** Sérialise des cues au format WebVTT (en-tête `WEBVTT`). */
export function toVtt(cues: readonly Cue[]): string {
  const clean = normalizeCues(cues);
  const blocks = clean.map((cue) => {
    const time = `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}`;
    return `${time}\n${cue.text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

/**
 * Transcription texte brut (Prompt 137, accessibilité) : un paragraphe par
 * cue, SANS timestamps ni index — lisible directement (lecteur d'écran,
 * relecture, recherche plein texte). Même ordre chronologique que .srt/.vtt.
 */
export function toPlainText(cues: readonly Cue[]): string {
  const clean = normalizeCues(cues);
  return `${clean.map((cue) => cue.text).join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Alignement transcription ↔ script de référence
// ---------------------------------------------------------------------------

/** Réduit un texte à sa suite de mots normalisés (minuscule, sans ponctuation). */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Réaligne des segments Whisper sur le texte SOURCE (la narration écrite du
 * script) : Whisper fournit des timestamps fiables mais un texte parfois
 * approximatif (accents, jargon technique). On garde donc les timestamps des
 * segments et on remplace leur texte par la portion correspondante du script
 * de référence, répartie au prorata du nombre de mots de chaque segment.
 *
 * `narrationTexts` est la liste des narrations dans l'ordre du script (une par
 * slide) ; elles sont concaténées en un flux de mots de référence, puis
 * redécoupées sur la grille temporelle des segments.
 */
export function alignToReference(
  segments: readonly WhisperSegment[],
  narrationTexts: readonly string[],
): Cue[] {
  const usable = segments
    .filter((s) => s.end > s.start && normalizeWords(s.text).length > 0)
    .sort((a, b) => a.start - b.start);
  if (usable.length === 0) return [];

  // Mots de référence, en conservant leur forme d'origine (ponctuation incluse).
  const referenceWords = narrationTexts.join(' ').split(/\s+/).filter((w) => w.length > 0);
  // Aucun texte de référence exploitable : on retombe sur le texte Whisper brut.
  if (referenceWords.length === 0) {
    return usable.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  }

  // Poids de chaque segment = nombre de mots transcrits (proxy de sa densité).
  const segmentWordCounts = usable.map((s) => Math.max(1, normalizeWords(s.text).length));
  const totalWeight = segmentWordCounts.reduce((a, b) => a + b, 0);

  const cues: Cue[] = [];
  let consumed = 0;
  usable.forEach((segment, index) => {
    const isLast = index === usable.length - 1;
    // Nombre de mots de référence attribués à ce segment (le dernier récupère le reste).
    const share = Math.round((segmentWordCounts[index]! / totalWeight) * referenceWords.length);
    const take = isLast ? referenceWords.length - consumed : Math.min(share, referenceWords.length - consumed);
    const words = referenceWords.slice(consumed, consumed + Math.max(0, take));
    consumed += words.length;
    const text = words.join(' ').trim();
    if (text.length > 0) {
      cues.push({ start: segment.start, end: segment.end, text });
    }
  });

  // Sécurité : des mots de référence restants (arrondis) sont ajoutés au dernier cue.
  if (consumed < referenceWords.length && cues.length > 0) {
    const rest = referenceWords.slice(consumed).join(' ').trim();
    const last = cues[cues.length - 1]!;
    last.text = `${last.text} ${rest}`.trim();
  }

  return cues;
}

// ---------------------------------------------------------------------------
// Repli déterministe : sous-titres dérivés du script (sans Whisper)
// ---------------------------------------------------------------------------

/**
 * Estime la durée de narration (secondes) d'un texte au débit AUDIO partagé.
 * Minimum 1 s pour qu'un cue reste lisible.
 */
export function estimateNarrationSeconds(text: string): number {
  const words = normalizeWords(text).length;
  const seconds = (words / AUDIO.NARRATION_WORDS_PER_MINUTE) * 60;
  return Math.max(1, seconds);
}

/** Élément minimal de script exploité par le repli : une narration + durée audio connue. */
export interface FallbackSlide {
  narration: string;
  /**
   * Durée du mp3 de la slide si elle a déjà été mesurée (TTS) ; sinon on
   * estime la durée depuis le nombre de mots au débit de narration.
   */
  audioSeconds?: number;
}

/**
 * Sous-titres de repli (qualité dégradée honnête) : une slide = un cue, calé
 * bout à bout sur les durées audio connues (ou estimées). Utilisé quand
 * faster-whisper est absent ou en mode MOCK — le texte reste EXACT (script),
 * seuls les timestamps sont approximatifs.
 */
export function subtitlesFromScript(slides: readonly FallbackSlide[]): Cue[] {
  const cues: Cue[] = [];
  let cursor = 0;
  for (const slide of slides) {
    const text = slide.narration.trim();
    if (text.length === 0) continue;
    const duration =
      slide.audioSeconds && slide.audioSeconds > 0
        ? slide.audioSeconds
        : estimateNarrationSeconds(text);
    cues.push({ start: cursor, end: cursor + duration, text });
    cursor += duration;
  }
  return cues;
}
