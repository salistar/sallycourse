// Nettoyage DSP d'un mp3 de narration (cas général, constaté en réel le
// 2026-07-21 sur le cours due diligence) : deux classes de défauts qui
// SURVIVENT à la resynthèse parce que la sortie TTS est déterministe
// (même texte → même audio, artefacts compris) :
//
//  1. MICRO-RAFALE : un bruit isolé de < 200 ms encadré de silence des deux
//     côtés (artefact vocal du modèle, « petit bruit » audible au milieu
//     d'une pause). Un vrai début de parole ne matche jamais ce motif : une
//     plosive est immédiatement SUIVIE de voix, pas de 350 ms de silence.
//     → rafale mise à zéro (volume=0 sur l'intervalle).
//
//  2. SILENCE INTÉRIEUR TROP LONG : une pause > ~1,2 s au milieu d'une slide
//     (« vide » perçu par l'auditeur). → compressée à ~0,9 s par
//     silenceremove. Garantit aussi la CONVERGENCE du bouton « Réparer
//     l'audio » : après nettoyage, plus aucun trou intérieur ≥ au seuil du
//     diagnostic (1,5 s), donc la slide n'est plus re-flaggée à chaque clic.
//
// Le plan (fonction pure, testée) est calculé depuis la sortie silencedetect ;
// l'application est UNE passe ffmpeg (volume mutes → silenceremove, dans cet
// ordre : les mutes s'évaluent sur la timeline d'origine, puis la compression
// raccourcit — une rafale mutée fusionne ses deux pauses voisines et le bloc
// fusionné est compressé d'un coup).
import { execa } from 'execa';
import { parseSilenceDetect, type SilenceGap } from './audio-repair.js';
import { AUDIO } from '../shared.js';

/**
 * Durée max d'une île sonore pour être considérée comme une rafale parasite.
 * Calibré sur le cas réel du 2026-07-21 : le mp3 fautif contenait DEUX îles
 * (46 ms et 353 ms) au milieu d'un bloc de pauses — un vrai mot isolé entre
 * deux silences ≥ 0,3 s n'existe pas dans une narration continue.
 */
export const BURST_MAX_SEC = 0.4;
/** Silence minimal requis DE CHAQUE CÔTÉ d'une île pour la classer rafale (= seuil de détection fine). */
export const BURST_GUARD_SILENCE_SEC = 0.3;
/** Au-delà de cette durée, un silence intérieur est compressé… */
export const SILENCE_CAP_TRIGGER_SEC = 1.0;
/** …à cette durée conservée. */
export const SILENCE_CAP_KEEP_SEC = 0.9;
/** Seuil silencedetect du nettoyage (plus fin que le diagnostic leçon). */
export const CLEANUP_NOISE_DB = -40;
/** Durée minimale d'un silence pour la détection fine. */
export const CLEANUP_MIN_SILENCE_SEC = 0.3;

export interface AudioCleanupPlan {
  /** Intervalles [début, fin] (s) à mettre à zéro (micro-rafales parasites). */
  mutes: Array<{ start: number; end: number }>;
  /** Au moins un silence intérieur dépasse le déclencheur de compression. */
  needsSilenceCap: boolean;
}

/**
 * Calcule le plan de nettoyage à partir des silences détectés. Pure —
 * aucune I/O. Les bords du fichier (avant le premier silence / après le
 * dernier) ne sont JAMAIS traités comme rafales : une amorce ou une chute
 * de fin courte est un motif normal.
 */
export function planAudioCleanup(silences: SilenceGap[], totalSeconds: number): AudioCleanupPlan {
  const mutes: Array<{ start: number; end: number }> = [];
  let needsSilenceCap = false;

  const sorted = [...silences].sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    // Silence intérieur (pas collé aux bords) trop long → compression requise.
    if (s.start > 0.05 && s.end < totalSeconds - 0.05 && s.end - s.start > SILENCE_CAP_TRIGGER_SEC) {
      needsSilenceCap = true;
    }
  }
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const prev = sorted[i]!;
    const next = sorted[i + 1]!;
    const islandStart = prev.end;
    const islandEnd = next.start;
    const island = islandEnd - islandStart;
    if (island <= 0) continue;
    const prevLen = prev.end - prev.start;
    const nextLen = next.end - next.start;
    if (island <= BURST_MAX_SEC && prevLen >= BURST_GUARD_SILENCE_SEC && nextLen >= BURST_GUARD_SILENCE_SEC) {
      // Marge de 5 ms de part et d'autre : couvre l'attaque/queue de la rafale.
      mutes.push({ start: Math.max(0, islandStart - 0.005), end: islandEnd + 0.005 });
    }
  }
  return { mutes, needsSilenceCap };
}

/** Construit la chaîne -af appliquant le plan (null si rien à faire). */
export function buildCleanupFilter(plan: AudioCleanupPlan): string | null {
  const parts: string[] = [];
  for (const m of plan.mutes) {
    parts.push(`volume=enable='between(t,${m.start.toFixed(3)},${m.end.toFixed(3)})':volume=0`);
  }
  if (plan.needsSilenceCap || plan.mutes.length > 0) {
    // stop_periods=-1 : compresse TOUS les silences intérieurs ; chaque bloc
    // dépassant SILENCE_CAP_KEEP_SEC est raccourci à cette durée. Appliqué
    // aussi dès qu'il y a un mute : la rafale neutralisée fusionne deux pauses
    // en un long bloc qu'il faut recomprimer.
    parts.push(
      `silenceremove=stop_periods=-1:stop_duration=${SILENCE_CAP_KEEP_SEC}:stop_threshold=${CLEANUP_NOISE_DB}dB`,
    );
  }
  return parts.length > 0 ? parts.join(',') : null;
}

/** Détecte les silences d'un fichier audio via ffmpeg silencedetect (seuils fins). */
export async function detectCleanupSilences(file: string): Promise<SilenceGap[]> {
  try {
    const { stderr } = await execa('ffmpeg', [
      '-i',
      file,
      '-af',
      `silencedetect=noise=${CLEANUP_NOISE_DB}dB:d=${CLEANUP_MIN_SILENCE_SEC}`,
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    return parseSilenceDetect(stderr);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    if (stderr) return parseSilenceDetect(stderr);
    throw err;
  }
}

/**
 * Nettoie un mp3 de narration en place-compatible : écrit le résultat sur
 * `output` et retourne true si un nettoyage a eu lieu, false si le fichier
 * était déjà propre (dans ce cas `output` n'est PAS écrit — l'appelant
 * continue avec l'original).
 */
export async function cleanNarrationAudio(input: string, output: string, totalSeconds: number): Promise<boolean> {
  const silences = await detectCleanupSilences(input);
  const plan = planAudioCleanup(silences, totalSeconds);
  const filter = buildCleanupFilter(plan);
  if (!filter) return false;
  await execa('ffmpeg', [
    '-y',
    '-i',
    input,
    '-af',
    filter,
    '-ar',
    String(AUDIO.SAMPLE_RATE),
    '-b:a',
    '128k',
    '-codec:a',
    'libmp3lame',
    output,
  ]);
  return true;
}
