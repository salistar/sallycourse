// Vérification d'INTELLIGIBILITÉ d'une narration (cas général, constaté en
// réel le 2026-07-21) : un segment TTS peut être « dégénéré » — voix qui
// change de timbre, mots inarticulés — sans AUCUNE signature détectable par
// l'analyse du signal (ni trou de silence, ni rafale, énergie et pitch
// normaux). Le seul détecteur fiable est sémantique : transcrire l'audio
// (Whisper, déjà déployé sur Modal) et comparer à la narration attendue.
// Similarité basse ⇒ la voix ne dit PAS clairement le texte ⇒ défectueux.
import { readFile } from 'node:fs/promises';
import { isModalWhisperConfigured, transcribeModalWhisper } from '../providers/modal-whisper-provider.js';
import { logger } from '../queues/index.js';

/** Sous ce score, la slide est considérée inintelligible (à re-synthétiser). */
export const GARBLED_SIMILARITY_MIN = 0.62;

/** Normalisation texte pour comparaison : minuscules, sans accents/ponctuation. */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similarité Dice sur BIGRAMMES de mots entre texte attendu et transcription
 * (0 → rien en commun, 1 → identique). Les bigrammes capturent l'ordre des
 * mots : une transcription de charabia qui recase des mots isolés du lexique
 * score bas, une transcription fidèle avec quelques fautes score haut.
 */
export function transcriptSimilarity(expected: string, actual: string): number {
  const a = normalizeForCompare(expected).split(' ').filter(Boolean);
  const b = normalizeForCompare(actual).split(' ').filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length === 1 || b.length === 1) {
    return a.join(' ') === b.join(' ') ? 1 : 0;
  }
  const bigrams = (words: string[]) => {
    const set = new Map<string, number>();
    for (let i = 0; i + 1 < words.length; i += 1) {
      const key = `${words[i]} ${words[i + 1]}`;
      set.set(key, (set.get(key) ?? 0) + 1);
    }
    return set;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  let inter = 0;
  for (const [key, countA] of ba) inter += Math.min(countA, bb.get(key) ?? 0);
  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * inter) / total;
}

export interface NarrationVerification {
  similarity: number;
  transcript: string;
}

/**
 * Transcrit un mp3 de slide via Whisper (Modal) et mesure sa similarité au
 * texte attendu. Retourne null si Whisper n'est pas configuré (la vérification
 * est alors simplement sautée — jamais bloquante) ou en cas d'échec réseau.
 */
export async function verifyNarrationAudio(
  audioPath: string,
  expectedNarration: string,
  locale: string,
): Promise<NarrationVerification | null> {
  if (!isModalWhisperConfigured()) return null;
  try {
    const audioB64 = (await readFile(audioPath)).toString('base64');
    const segments = await transcribeModalWhisper(audioB64, locale);
    const transcript = segments.map((s) => s.text).join(' ').trim();
    const similarity = transcriptSimilarity(expectedNarration, transcript);
    return { similarity, transcript };
  } catch (err) {
    logger.warn({ err }, 'vérification Whisper impossible — ignorée (best-effort)');
    return null;
  }
}
