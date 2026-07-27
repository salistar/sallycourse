// Transcription faster-whisper (Prompt 210) — extrait de subtitle-generation.ts
// (Prompt 25) pour être RÉUTILISÉ par le processor de dictée vocale sans
// duplication. Un sous-processus Python (venv /opt/whisper, ENV WHISPER_BIN)
// lit un média local et renvoie des segments JSON sur stdout. Aucun GPU, aucun
// service externe. Le comportement et le repli dégradé sont INCHANGÉS : si le
// binaire/module Python est absent ou échoue, transcribeWithWhisper renvoie null
// et l'appelant retombe sur sa stratégie de repli.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { logger } from '../queues/index.js';
import { isModalWhisperConfigured, transcribeModalWhisper } from '../providers/modal-whisper-provider.js';
import type { WhisperSegment } from './subtitles.js';

/** Modèle faster-whisper : « small » = bon compromis vitesse/qualité sur CPU. */
export const WHISPER_MODEL = 'small';

/** Codes langue faster-whisper (ISO 639-1) par locale de cours (sous-titrage). */
export const WHISPER_LANGUAGE: Record<string, string> = { fr: 'fr', en: 'en', ar: 'ar' };

/** Script Python inline : faster-whisper → JSON de segments sur stdout. */
export function whisperPythonScript(): string {
  return [
    'import json, sys',
    'from faster_whisper import WhisperModel',
    'media_path, model_name, language = sys.argv[1], sys.argv[2], sys.argv[3]',
    "model = WhisperModel(model_name, device='cpu', compute_type='int8')",
    'segments, _ = model.transcribe(media_path, language=language, word_timestamps=True)',
    'out = [{"start": s.start, "end": s.end, "text": s.text} for s in segments]',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
}

/**
 * Transcrit un média via faster-whisper (sous-processus Python). Retourne les
 * segments, ou null si le binaire Python / le module est indisponible (repli).
 * `dir` est un dossier temporaire où écrire le script Python (isolé par appel).
 */
export async function transcribeWithWhisper(
  mediaPath: string,
  language: string,
  dir: string,
  model: string = WHISPER_MODEL,
): Promise<WhisperSegment[] | null> {
  // Chemin GPU prioritaire : Whisper large-v3 sur Modal (bien plus précis, surtout
  // en darija/arabe). Si non configuré ou en échec, repli sur le faster-whisper CPU
  // ci-dessous — comportement historique strictement inchangé.
  if (isModalWhisperConfigured()) {
    try {
      const audioB64 = (await readFile(mediaPath)).toString('base64');
      const segments = await transcribeModalWhisper(audioB64, language || undefined);
      if (segments.length > 0) return segments;
      logger.warn({ mediaPath }, 'Modal Whisper : 0 segment — repli sur faster-whisper CPU');
    } catch (err) {
      logger.warn({ mediaPath, err }, 'Modal Whisper indisponible — repli sur faster-whisper CPU');
    }
  }

  const bin = process.env.WHISPER_BIN ?? 'python';
  const scriptPath = path.join(dir, 'whisper_transcribe.py');
  await writeFile(scriptPath, whisperPythonScript(), 'utf8');

  try {
    const { stdout } = await execa(bin, [scriptPath, mediaPath, model, language], {
      // Transcription CPU longue : pas de timeout agressif (le job BullMQ borne déjà).
      timeout: 0,
    });
    const parsed = JSON.parse(stdout) as WhisperSegment[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (s) => typeof s?.start === 'number' && typeof s?.end === 'number' && typeof s?.text === 'string',
    );
  } catch (err) {
    logger.warn({ mediaPath, err }, 'faster-whisper indisponible ou en échec — repli sur le script');
    return null;
  }
}

/**
 * Transcription « texte seul » (Prompt 210, dictée) : concatène le texte des
 * segments en une chaîne unique, sans timestamps. Retourne null si Whisper est
 * indisponible (l'appelant décide alors du repli — ex. saisie manuelle).
 */
export async function transcribeAudioText(
  mediaPath: string,
  language: string,
  dir: string,
): Promise<string | null> {
  const segments = await transcribeWithWhisper(mediaPath, language, dir);
  if (!segments || segments.length === 0) return null;
  const text = segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}
