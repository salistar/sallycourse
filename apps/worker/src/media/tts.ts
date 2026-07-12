// Synthèse vocale multilingue (Prompt 23, OSS Prompt 153) : narration d'une
// slide → mp3. Chaîne de repli : cache → Piper (OSS, défaut plan Free) →
// ElevenLabs (PREMIUM, plans pro/business uniquement) → OpenAI TTS (repli
// universel) → silence réaliste (ffmpeg anullsrc) si MOCK_PROVIDERS ou aucun
// provider exploitable. Chaque résultat est normalisé en loudness (-16 LUFS)
// puis mesuré (ffprobe) — Piper/Kokoro passent par la MÊME normalisation que
// ElevenLabs/OpenAI (aucun chemin ne saute normalizeLoudness). Un cache
// storage tts-cache/{sha256(texte+voix)}.mp3 évite de re-synthétiser un segment
// déjà produit (HeadObject avant tout appel payant).
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import {
  AUDIO,
  getConfig,
  getObjectStream,
  objectExists,
  storageKeys,
  uploadObject,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { bumpCacheStat } from '../lib/cache.js';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';
import { isElevenLabsAllowedForPlan, isKokoroConfigured, synthesizeKokoro } from '../providers/kokoro-provider.js';
import { isPiperConfigured, synthesizePiper } from '../providers/piper-provider.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type PlanId } from '@sallycourse/shared';

/** Voix ElevenLabs par défaut selon la langue de la narration. */
const ELEVENLABS_DEFAULT_VOICES: Record<string, string> = {
  fr: 'ThT5KcBeYPX3keUQqHPh', // Dorothy — voix multilingue neutre
  en: '21m00Tcm4TlvDq8ikWAM', // Rachel
  ar: 'ThT5KcBeYPX3keUQqHPh', // repli multilingue
};
const ELEVENLABS_FALLBACK_VOICE = 'ThT5KcBeYPX3keUQqHPh';

/** Voix OpenAI TTS par défaut (repli, indépendant de la langue). */
const OPENAI_DEFAULT_VOICE = 'alloy';

/** Modèle ElevenLabs multilingue (couvre fr/en/ar). */
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
/** Modèle OpenAI TTS. */
const OPENAI_TTS_MODEL = 'tts-1';

/** Débit de silence de secours : durée réaliste calquée sur le débit de narration. */
const SILENCE_MIN_SECONDS = 1.5;

/**
 * Circuit breaker ElevenLabs (Prompt 77) : après 5 échecs consécutifs, on
 * arrête de solliciter ElevenLabs pendant 60s (bascule directe vers OpenAI)
 * au lieu de re-tenter un service manifestement down à chaque slide — évite
 * de payer la latence d'un appel voué à l'échec sur tout un lot de slides.
 */
export const elevenLabsBreaker = new CircuitBreaker('elevenlabs-tts', {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
});

/**
 * URLs de base surchargées (mock-server / proxy local) — rétrocompatibles :
 * absentes → endpoints publics par défaut. On enlève un éventuel « / » final
 * pour concaténer proprement les chemins.
 */
function baseUrl(envKey: string, fallback: string): string {
  const raw = process.env[envKey]?.trim();
  return (raw && raw.length > 0 ? raw : fallback).replace(/\/+$/, '');
}
const ELEVENLABS_BASE_URL = baseUrl('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io');
const OPENAI_BASE_URL = baseUrl('OPENAI_BASE_URL', 'https://api.openai.com/v1');

export type TtsProvider = 'piper' | 'kokoro' | 'elevenlabs' | 'openai' | 'mock' | 'cache';

export interface SynthesizeSlideParams {
  /** Texte à synthétiser (narration de la slide). */
  text: string;
  /** Langue de la narration (fr/en/ar) — choisit la voix par défaut. */
  locale: string;
  /** Voix forcée (Course.ttsVoice) : identifiant ElevenLabs. Sinon défaut par langue. */
  voice?: string;
  /**
   * Vitesse de narration (Prompt 137, accessibilité — Course.narrationSpeed) :
   * 1 = débit standard, plage 0.75–1.25. Répercutée sur ElevenLabs
   * (voice_settings.speed) et OpenAI TTS (speed) ; sur le silence de secours,
   * ajuste la durée estimée pour rester synchrone avec les sous-titres.
   */
  speed?: number;
  /**
   * Plan de l'utilisateur (P153) : ElevenLabs est une option PREMIUM (pro/
   * business uniquement) — voir isElevenLabsAllowedForPlan. Absent → défaut
   * rétrocompatible (ElevenLabs reste tenté comme avant P153) : c'est aux
   * appelants qui CONNAISSENT le plan réel (ex. tts-generation.ts, via
   * planForCourse) de le fournir explicitement pour activer la vérification.
   */
  plan?: PlanId | string;
}

/** Borne la vitesse de narration à la plage supportée (Course.narrationSpeed). */
export function clampNarrationSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1;
  return Math.min(1.25, Math.max(0.75, speed));
}

export interface SynthesizeSlideResult {
  /** Clé S3 du mp3 normalisé (dans le cache partagé tts-cache/). */
  cacheKey: string;
  /** Durée mesurée du mp3, en secondes. */
  seconds: number;
  /** Provider ayant réellement produit (ou servi) l'audio. */
  provider: TtsProvider;
}

/** Voix effective pour un couple (voix forcée, langue) côté ElevenLabs. */
export function resolveVoice(locale: string, voice?: string): string {
  if (voice && voice.trim()) return voice.trim();
  return ELEVENLABS_DEFAULT_VOICES[locale] ?? ELEVENLABS_FALLBACK_VOICE;
}

/**
 * Clé de cache déterministe : sha256 du texte normalisé + voix + langue +
 * vitesse (P137 — deux vitesses différentes du même texte ne doivent JAMAIS
 * partager un mp3 en cache). `speed` par défaut 1 : ne change pas les clés
 * déjà en cache pour les appels sans vitesse explicite.
 */
export function ttsCacheKey(text: string, voice: string, locale: string, speed = 1): string {
  const normalizedSpeed = clampNarrationSpeed(speed);
  const speedSuffix = normalizedSpeed === 1 ? '' : ` speed=${normalizedSpeed}`;
  const hash = createHash('sha256').update(`${locale} ${voice} ${text.trim()}${speedSuffix}`).digest('hex');
  return storageKeys.ttsCache(hash);
}

/**
 * Durée réaliste d'un silence de secours (mots / débit × 60), plancher inclus.
 * `speed` (P137, Course.narrationSpeed) accélère/ralentit l'estimation pour
 * rester cohérente avec un TTS réel accéléré/ralenti.
 */
export function estimateNarrationSeconds(text: string, speed = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const seconds = (words / AUDIO.NARRATION_WORDS_PER_MINUTE) * 60;
  return Math.max(SILENCE_MIN_SECONDS, seconds / clampNarrationSpeed(speed));
}

// ── ffmpeg / ffprobe ────────────────────────────────────────────

/** Mesure la durée d'un fichier audio via ffprobe (secondes). */
export async function probeDurationSeconds(file: string): Promise<number> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe: durée invalide pour ${file} (« ${stdout.trim()} »)`);
  }
  return seconds;
}

/**
 * Normalise le loudness à AUDIO.TARGET_LUFS (-16 LUFS, TP -1.5, LRA 11) en une
 * passe loudnorm, réencode en mp3. Retourne le chemin du fichier normalisé.
 */
async function normalizeLoudness(input: string, output: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-i',
    input,
    '-af',
    `loudnorm=I=${AUDIO.TARGET_LUFS}:TP=-1.5:LRA=11`,
    '-ar',
    '44100',
    '-b:a',
    '128k',
    '-codec:a',
    'libmp3lame',
    output,
  ]);
}

/** Génère un silence mp3 de la durée demandée (ffmpeg anullsrc). */
async function synthesizeSilence(seconds: number, output: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    seconds.toFixed(2),
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    output,
  ]);
}

// ── Providers payants ───────────────────────────────────────────

/** Statut HTTP considéré comme « quota/auth » → bascule vers le repli. */
function isQuotaOrAuth(status: number): boolean {
  return status === 429 || status === 401 || status === 403;
}

/** Synthèse ElevenLabs (mp3 brut). Jette une erreur explicite en cas d'échec. */
async function synthesizeElevenLabs(text: string, voiceId: string, apiKey: string, speed: number): Promise<Buffer> {
  const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      // speed (P137, Course.narrationSpeed) : paramètre natif ElevenLabs
      // (plage 0.7-1.2 documentée) — clampNarrationSpeed reste dans ces bornes.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`ElevenLabs ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Synthèse OpenAI TTS (mp3 brut). Jette une erreur explicite en cas d'échec. */
async function synthesizeOpenAi(text: string, apiKey: string, speed: number): Promise<Buffer> {
  const res = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_DEFAULT_VOICE,
      input: text,
      response_format: 'mp3',
      // speed (P137, Course.narrationSpeed) : paramètre natif OpenAI TTS (0.25-4.0).
      speed,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS ${res.status} : ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Lit un stream S3 en Buffer complet. */
async function streamToBuffer(key: string): Promise<Buffer> {
  const stream = await getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Synthétise la narration d'une slide en mp3 normalisé, met en cache le résultat
 * et renvoie sa clé S3 + durée. Ordre (P153) : cache → Piper (OSS, gratuit,
 * défaut plan Free si configuré) → ElevenLabs (PREMIUM, pro/business
 * uniquement — voir isElevenLabsAllowedForPlan) → OpenAI (repli universel) →
 * silence. MOCK_PROVIDERS ou aucun provider exploitable → directement silence
 * (zéro appel payant/réseau).
 */
export async function synthesizeSlide(params: SynthesizeSlideParams): Promise<SynthesizeSlideResult> {
  const { text, locale } = params;
  const voice = resolveVoice(locale, params.voice);
  const speed = clampNarrationSpeed(params.speed);
  const cacheKey = ttsCacheKey(text, voice, locale, speed);

  // 1) Cache : segment déjà produit → on mesure sa durée sans re-synthétiser.
  if (await objectExists(cacheKey)) {
    const dir = await mkdtemp(path.join(tmpdir(), 'tts-cache-'));
    try {
      const cachedPath = path.join(dir, 'cached.mp3');
      await writeFile(cachedPath, await streamToBuffer(cacheKey));
      const seconds = await probeDurationSeconds(cachedPath);
      logger.info({ cacheKey, seconds }, 'TTS servi depuis le cache');
      await bumpCacheStat('tts', 'hit');
      return { cacheKey, seconds, provider: 'cache' };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  await bumpCacheStat('tts', 'miss');

  const cfg = getConfig();
  const piperAvailable = isPiperConfigured();
  const kokoroAvailable = isKokoroConfigured();
  // Voix clonée Kokoro (P153, remplaçant OSS de XTTS pour P81) : reconnaissable
  // à son préfixe (mockKokoroVoiceId ou id réel préfixé côté route API).
  const isKokoroVoice = Boolean(params.voice?.startsWith('mock-kokoro-voice-') || params.voice?.startsWith('kokoro-'));
  // ElevenLabs PREMIUM (P153) : gating explicite. `params.plan` absent →
  // rétrocompatible (autorisé, comportement pré-P153) — voir doc du champ.
  const elevenLabsAllowed = params.plan === undefined || isElevenLabsAllowedForPlan(params.plan);
  const mock =
    cfg.MOCK_PROVIDERS ||
    (!piperAvailable && !(kokoroAvailable && isKokoroVoice) && !(elevenLabsAllowed && cfg.ELEVENLABS_API_KEY) && !cfg.OPENAI_API_KEY);

  const dir = await mkdtemp(path.join(tmpdir(), 'tts-'));
  const rawPath = path.join(dir, 'raw.mp3');
  const normPath = path.join(dir, 'norm.mp3');
  try {
    let provider: TtsProvider;

    if (mock) {
      // Court-circuit déterministe : silence de durée réaliste, aucun appel réseau.
      await synthesizeSilence(estimateNarrationSeconds(text, speed), normPath);
      provider = 'mock';
    } else {
      let audio: Buffer | null = null;
      provider = 'mock';

      // 0) Kokoro (OSS, voix clonée P81) — prioritaire dès qu'une voix clonée
      // Kokoro est explicitement forcée : Piper/ElevenLabs ne savent pas la
      // reproduire (ce ne sont pas des voix clonées).
      if (!audio && isKokoroVoice && kokoroAvailable) {
        try {
          audio = await synthesizeKokoro(text, locale, params.voice, speed);
          provider = 'kokoro';
        } catch (err) {
          logger.warn({ err }, 'Kokoro indisponible — bascule vers le repli suivant');
        }
      }

      // 1) Piper (OSS, gratuit, CPU) — tenté ensuite quand configuré et qu'aucune
      // voix clonée n'est demandée : c'est le chemin par défaut du plan Free,
      // aucun coût par caractère.
      if (!audio && !isKokoroVoice && piperAvailable) {
        try {
          audio = await synthesizePiper(text, locale, params.voice, speed);
          provider = 'piper';
        } catch (err) {
          logger.warn({ err }, 'Piper indisponible — bascule vers le repli suivant');
        }
      }

      // 2) ElevenLabs (PREMIUM) — seulement si le plan l'autorise.
      if (!audio && elevenLabsAllowed && cfg.ELEVENLABS_API_KEY) {
        try {
          audio = await elevenLabsBreaker.execute(() => synthesizeElevenLabs(text, voice, cfg.ELEVENLABS_API_KEY!, speed));
          provider = 'elevenlabs';
        } catch (err) {
          if (err instanceof CircuitOpenError) {
            // Panne déjà détectée (≥5 échecs consécutifs) : bascule silencieuse
            // vers OpenAI, pas de nouveau log d'erreur ElevenLabs par slide.
            logger.debug({ breaker: 'elevenlabs-tts' }, 'ElevenLabs circuit ouvert — bascule directe OpenAI');
          } else {
            const status = (err as { status?: number }).status;
            logger.warn({ err, status }, 'ElevenLabs indisponible — bascule vers le repli');
            // On ne tente OpenAI que si l'échec est récupérable (quota/auth) ou réseau.
            if (status !== undefined && !isQuotaOrAuth(status) && status >= 400 && status < 500) {
              throw err; // 400 « mauvais texte » : inutile de basculer.
            }
          }
        }
      }

      if (!audio && cfg.OPENAI_API_KEY) {
        audio = await synthesizeOpenAi(text, cfg.OPENAI_API_KEY, speed);
        provider = 'openai';
      }

      if (!audio) {
        // Aucun provider exploitable en pratique (quota/pannes partout) → silence réaliste.
        await synthesizeSilence(estimateNarrationSeconds(text, speed), normPath);
        provider = 'mock';
      } else {
        await writeFile(rawPath, audio);
        await normalizeLoudness(rawPath, normPath);
      }
    }

    const seconds = await probeDurationSeconds(normPath);
    await uploadObject(cacheKey, await readFile(normPath), 'audio/mpeg');
    logger.info({ cacheKey, provider, seconds }, 'TTS synthétisé et mis en cache');
    return { cacheKey, seconds, provider };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
