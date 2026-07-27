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

// ── Réalignement de lisibilité (P?, audit 2026-07-17) ────────────────────────
// Les cues bruts de Whisper (ou de l'estimation) présentent des défauts de
// lisibilité : cues de quelques ms, cues de >20 s, mots orphelins, ~560 wpm
// d'affichage. Ces bornes (calées sur les standards de sous-titrage, ex. Netflix)
// produisent des cues confortables à lire.
const MIN_CUE_SEC = 1.0;
const MAX_CUE_SEC = 6.0;
/** Vitesse de lecture max (caractères/seconde) — ~17 cps ≈ ~200 mots/min. */
const MAX_CPS = 17;
/** Écart minimal entre deux cues consécutifs (2 frames à 50 fps). */
const MIN_GAP_SEC = 0.04;
/**
 * Densité max de mots par cue (audit ESG 2026-07-19, E4) : MAX_CPS borne le
 * débit de LECTURE mais pas le nombre de mots affichés d'un coup — un cue de
 * durée normale peut malgré tout entasser 20+ mots (fusion de mots orphelins,
 * étape 1) et flasher illisiblement. Complète MAX_CPS, ne le remplace pas.
 */
const MAX_WORDS_PER_CUE = 15;

/**
 * Corrige la LISIBILITÉ d'une liste de cues sans changer le sens : (1) fusionne
 * les mots orphelins et cues trop courts dans le voisin ; (2) étire les cues
 * trop courts / trop rapides dans le silence qui suit (jamais sur le cue
 * suivant) ; (3) découpe les cues trop longs aux frontières de mots. Fonction
 * PURE et idempotente. Ne comble PAS les silences légitimes entre phrases.
 */
export function realignCues(cues: readonly Cue[]): Cue[] {
  const base = normalizeCues(cues);
  if (base.length === 0) return [];

  // 1) Fusion des cues trop courts (les mots orphelins qui « flashent » sont
  //    précisément ceux-là) dans le cue PRÉCÉDENT — tant que la fusion ne le
  //    rend pas lui-même trop long. Un cue d'un seul mot mais de durée normale
  //    reste lisible : on ne le fusionne PAS (et fusionner en arrière par-delà
  //    une frontière de phrase serait sémantiquement faux).
  const merged: Cue[] = [];
  for (const cue of base) {
    const prev = merged[merged.length - 1];
    const tooShort = cue.end - cue.start < MIN_CUE_SEC;
    if (prev && tooShort && cue.end - prev.start <= MAX_CUE_SEC * 1.6) {
      prev.text = `${prev.text} ${cue.text}`;
      prev.end = cue.end;
      continue;
    }
    merged.push({ ...cue });
  }

  // 2) Étirement dans le silence suivant : durée mini + vitesse de lecture.
  //
  // Correctif 1.4 (audit 2026-07-20) : la version précédente plafonnait
  // l'étirement à `next.start - MIN_GAP_SEC` — SANS JAMAIS déplacer `next`.
  // Or quand les cues sont posés bout à bout (aucun silence naturel entre eux :
  // segments Whisper contigus, ou `subtitlesFromScript` qui enchaîne les
  // slides sans gap), ce plafond égale `cur.end` lui-même : l'étirement était
  // silencieusement neutralisé. C'est exactement ce que l'audit a mesuré
  // (cues affichés jusqu'à 737 mots/min malgré MIN_CUE_SEC=1s). Le cue
  // suivant est désormais REPOUSSÉ si l'étirement empiète dessus — cur.start
  // (l'instant réel où la phrase commence à l'oral) n'est JAMAIS modifié,
  // seule la fenêtre d'AFFICHAGE glisse. Compromis assumé et standard en
  // sous-titrage professionnel (ex. Netflix Timed Text Style Guide) : la
  // durée de lecture minimale prime sur une synchronisation seconde-près.
  for (let i = 0; i < merged.length; i += 1) {
    const cur = merged[i]!;
    const needForSpeed = cur.text.length / MAX_CPS;
    const wanted = Math.min(MAX_CUE_SEC, Math.max(MIN_CUE_SEC, needForSpeed));
    const target = cur.start + wanted;
    if (target > cur.end) {
      cur.end = target;
      const next = merged[i + 1];
      if (next && cur.end + MIN_GAP_SEC > next.start) {
        next.start = cur.end + MIN_GAP_SEC;
      }
    }
  }

  // 3) Découpe des cues trop longs OU trop denses (>MAX_WORDS_PER_CUE mots)
  //    aux frontières de mots (temps réparti).
  const out: Cue[] = [];
  for (const cue of merged) {
    const dur = cue.end - cue.start;
    const words = cue.text.split(/\s+/).filter(Boolean);
    const tooLong = dur > MAX_CUE_SEC + 0.25;
    const tooDense = words.length > MAX_WORDS_PER_CUE;
    if (!tooLong && !tooDense) {
      out.push(cue);
      continue;
    }
    const parts = Math.max(Math.ceil(dur / MAX_CUE_SEC), Math.ceil(words.length / MAX_WORDS_PER_CUE));
    const perPart = Math.max(1, Math.ceil(words.length / parts));
    for (let p = 0; p * perPart < words.length; p += 1) {
      const chunk = words.slice(p * perPart, (p + 1) * perPart).join(' ');
      if (!chunk) continue;
      out.push({
        start: cue.start + (dur * p) / parts,
        end: cue.start + (dur * (p + 1)) / parts,
        text: chunk,
      });
    }
  }
  return normalizeCues(out);
}

/** Sérialise des cues au format SRT (index 1-based, ligne vide entre blocs). */
export function toSrt(cues: readonly Cue[]): string {
  const clean = realignCues(cues);
  const blocks = clean.map((cue, index) => {
    const time = `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`;
    return `${index + 1}\n${time}\n${cue.text}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

/** Sérialise des cues au format WebVTT (en-tête `WEBVTT`). */
export function toVtt(cues: readonly Cue[]): string {
  const clean = realignCues(cues);
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
