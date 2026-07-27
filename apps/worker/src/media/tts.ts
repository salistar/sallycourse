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
  objectExists,
  readObjectBuffer,
  storageKeys,
  uploadObject,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { bumpCacheStat } from '../lib/cache.js';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';
import { isElevenLabsAllowedForPlan, isKokoroConfigured, synthesizeKokoro } from '../providers/kokoro-provider.js';
import { isPiperConfigured, synthesizePiper } from '../providers/piper-provider.js';
import { isEdgeTtsConfigured, synthesizeEdgeTts } from '../providers/edge-tts-provider.js';
import { isModalTtsConfigured, synthesizeModalTts } from '../providers/modal-tts-provider.js';
import { isQwen3TtsConfigured, synthesizeQwen3Tts } from '../providers/qwen3-tts-provider.js';
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

export type TtsProvider = 'modal' | 'qwen3' | 'edge' | 'piper' | 'kokoro' | 'elevenlabs' | 'openai' | 'mock' | 'cache';

/** Moteur de voix premium préféré (Course.ttsEngine / bouton « switch », audit 2026-07-22). */
export type TtsEngine = 'chatterbox' | 'qwen3';

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
  /**
   * Échantillon vocal (WAV base64) pour le CLONAGE via Chatterbox/Modal
   * (Course.useCustomVoice). Utilisé uniquement si Modal TTS est disponible ;
   * ignoré par les autres providers. Voir modal-tts-provider (audio_prompt_b64).
   */
  voiceSampleB64?: string;
  /**
   * Identifiant stable de l'échantillon (ex. `${userId}:${uploadedAt}`) — entre
   * dans la clé de cache pour ne PAS confondre une narration clonée avec la
   * version voix standard du même texte (et invalider si l'échantillon change).
   */
  voiceSampleId?: string;
  /**
   * Contexte de traçabilité, PUREMENT pour la journalisation côté provider
   * (ex. `${courseId}:${lessonId}:slide${index}`) — audit ESG 2026-07-20 (E14) :
   * sans ça, impossible de corréler un défaut audio observé après coup avec
   * les logs `modal app logs` du run qui l'a produit. N'entre PAS dans la clé
   * de cache ni n'influence la synthèse — silencieusement ignoré par les
   * providers qui ne le consomment pas (seul Modal/Chatterbox l'exploite).
   */
  context?: string;
  /**
   * Ignore une entrée de cache EXISTANTE et force une nouvelle synthèse (Lot 2,
   * réparation audio) : sans ce flag, une resynthèse du même texte/voix/langue/
   * vitesse retomberait sur EXACTEMENT le même mp3 en cache — y compris s'il
   * est celui, dégénéré, qu'on cherche justement à réparer. Le résultat est
   * malgré tout RÉÉCRIT sous la même clé de cache (comportement voulu : les
   * générations futures du même texte profitent aussi du résultat réparé).
   */
  bypassCache?: boolean;
  /**
   * Providers à SAUTER dans la cascade (réparation audio, escalade qualité) :
   * la sortie d'un provider étant déterministe (même texte → même audio,
   * artefacts vocaux compris), re-synthétiser un segment dégénéré chez le
   * MÊME provider reproduit le défaut à l'identique — l'exclure force la
   * cascade vers le repli suivant (ex. modal → edge).
   */
  excludeProviders?: TtsProvider[];
  /**
   * Moteur premium préféré (audit qualité modèles 2026-07-22, additif — voir
   * Course.ttsEngine et le bouton « switch » de audio-repair.ts). Absent (ou
   * 'chatterbox') : comportement INCHANGÉ — Modal/Chatterbox reste tenté en
   * premier, clé de cache identique à avant cet ajout (aucune régression sur
   * les cours existants). 'qwen3' : Qwen3-TTS est tenté AVANT Chatterbox dans
   * la cascade, ET la clé de cache porte un suffixe dédié — sans ça, une
   * narration déjà en cache côté Chatterbox (même texte/voix/langue/vitesse)
   * serait servie telle quelle sans jamais appeler Qwen3-TTS.
   */
  ttsEngine?: TtsEngine;
  /**
   * Voix Edge SOURCE de la voix du cours (catalogue de voix, fix « voix
   * multiples » 2026-07-26) : quand la cascade retombe sur Edge, elle utilise
   * cette voix précise (l'identité que les moteurs premium clonent via
   * voiceSampleB64) au lieu du défaut par langue — le repli garde donc la
   * même identité vocale que le reste de la leçon. Entre dans la clé de
   * cache quand présent (deux voix du catalogue ne partagent jamais un mp3).
   * Absent → comportement historique inchangé (clés de cache identiques).
   */
  edgeVoice?: string;
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
 * déjà en cache pour les appels sans vitesse explicite. `engineTag` (audit
 * 2026-07-22, additif) : namespace SÉPARÉ pour un moteur premium non-défaut
 * (ex. 'qwen3') — sans lui, une narration Qwen3-TTS partagerait la clé de
 * cache d'une narration Chatterbox déjà produite pour le même texte/voix/
 * langue/vitesse, et servirait l'ancien mp3 sans jamais appeler le nouveau
 * moteur. Omis (défaut/'chatterbox') : clé IDENTIQUE à avant cet ajout.
 */
export function ttsCacheKey(text: string, voice: string, locale: string, speed = 1, engineTag?: string): string {
  const normalizedSpeed = clampNarrationSpeed(speed);
  const speedSuffix = normalizedSpeed === 1 ? '' : ` speed=${normalizedSpeed}`;
  const engineSuffix = engineTag ? ` engine=${engineTag}` : '';
  const hash = createHash('sha256').update(`${locale} ${voice} ${text.trim()}${speedSuffix}${engineSuffix}`).digest('hex');
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
 * passe loudnorm, réencode en mp3. `tempo` optionnel (atempo, pitch préservé) :
 * < 1 ralentit la narration — voir narrationTempo. Retourne via `output`.
 */
async function normalizeLoudness(input: string, output: string, tempo = 1): Promise<void> {
  const tempoPrefix = tempo !== 1 ? `atempo=${tempo.toFixed(3)},` : '';
  await execa('ffmpeg', [
    '-y',
    '-i',
    input,
    '-af',
    `${tempoPrefix}loudnorm=I=${AUDIO.TARGET_LUFS}:TP=-1.5:LRA=11`,
    '-ar',
    String(AUDIO.SAMPLE_RATE),
    '-b:a',
    '128k',
    '-codec:a',
    'libmp3lame',
    output,
  ]);
}

/** Plafond de débit au-delà duquel on ralentit la narration (zone de confort e-learning : 150-160 wpm). */
export const MAX_NARRATION_WPM = 170;
/** Débit visé quand le plafond est dépassé. */
export const TARGET_NARRATION_WPM = 155;

/**
 * Facteur atempo appliqué à la narration brute d'une slide :
 * - `providerHonorsSpeed=false` (Chatterbox/Modal — l'endpoint n'a PAS de
 *   paramètre de vitesse) : applique d'abord la vitesse voulue par l'auteur
 *   (Course.narrationSpeed), ignorée jusqu'ici sur ce provider ;
 * - puis PLAFOND universel : un débit mesuré > MAX_NARRATION_WPM est ramené
 *   vers TARGET_NARRATION_WPM (mesuré en réel : Chatterbox sortait ~200 wpm,
 *   ~30 % au-dessus du confort — réf. cours humains : 135-160 wpm).
 * Borné à [0.75, 1.25] (contrat narrationSpeed + qualité atempo).
 */
export function narrationTempo(
  text: string,
  rawSeconds: number,
  speed = 1,
  providerHonorsSpeed = true,
): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0 || words === 0) return 1;
  let tempo = providerHonorsSpeed ? 1 : clampNarrationSpeed(speed);
  const effectiveWpm = (words / rawSeconds) * 60 * tempo;
  if (effectiveWpm > MAX_NARRATION_WPM) {
    tempo *= TARGET_NARRATION_WPM / effectiveWpm;
  }
  return Math.min(1.25, Math.max(0.75, tempo));
}

/** Génère un silence mp3 de la durée demandée (ffmpeg anullsrc). */
async function synthesizeSilence(seconds: number, output: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=${AUDIO.SAMPLE_RATE}:cl=mono`,
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

// (helper « stream S3 → Buffer » factorisé dans @sallycourse/shared/storage —
// audit dédup 2026-07-26 : voir readObjectBuffer.)

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
  // Clonage vocal Chatterbox : réel uniquement si Modal TTS est dispo. On fige
  // ici `useClone` pour que la clé de cache reflète EXACTEMENT ce qui sera
  // produit (clonée vs standard) — sinon un segment standard mis en cache
  // serait resservi à la place de la voix clonée (et inversement).
  const excluded = new Set(params.excludeProviders ?? []);
  const modalAvailable = !excluded.has('modal') && isModalTtsConfigured();
  // Qwen3-TTS (audit qualité modèles 2026-07-22, additif) : même rôle que
  // Modal/Chatterbox (voix premium + clonage), moteur alternatif choisi via
  // `ttsEngine`. Voir doc du champ dans SynthesizeSlideParams.
  const qwen3Available = !excluded.has('qwen3') && isQwen3TtsConfigured();
  const preferQwen3 = params.ttsEngine === 'qwen3';
  const useClone = Boolean(params.voiceSampleB64 && params.voiceSampleId && (modalAvailable || qwen3Available));
  // Identité de voix du catalogue (fix « voix multiples ») : la voix Edge
  // source entre dans la clé de cache dès qu'elle est fournie — deux voix du
  // catalogue ne partagent JAMAIS un mp3, clonage actif ou non. Absente →
  // clés strictement identiques à avant ce correctif.
  const edgeTag = params.edgeVoice ? `|edge:${params.edgeVoice}` : '';
  const cacheVoice = (useClone ? `${voice}|clone:${params.voiceSampleId}` : voice) + edgeTag;
  // Tag de cache SÉPARÉ uniquement quand Qwen3 est explicitement préféré — le
  // chemin par défaut (undefined/'chatterbox') garde une clé identique à avant
  // cet ajout (voir doc de ttsCacheKey).
  const cacheKey = ttsCacheKey(text, cacheVoice, locale, speed, preferQwen3 ? 'qwen3' : undefined);

  // 1) Cache : segment déjà produit → on mesure sa durée sans re-synthétiser.
  // `bypassCache` (Lot 2, réparation audio) saute cette lecture pour forcer une
  // synthèse fraîche — voir doc du champ.
  if (!params.bypassCache && (await objectExists(cacheKey))) {
    const dir = await mkdtemp(path.join(tmpdir(), 'tts-cache-'));
    try {
      const cachedPath = path.join(dir, 'cached.mp3');
      await writeFile(cachedPath, await readObjectBuffer(cacheKey));
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
  const edgeAvailable = !excluded.has('edge') && isEdgeTtsConfigured();
  const piperAvailable = !excluded.has('piper') && isPiperConfigured();
  const kokoroAvailable = !excluded.has('kokoro') && isKokoroConfigured();
  // Voix clonée Kokoro (P153, remplaçant OSS de XTTS pour P81) : reconnaissable
  // à son préfixe (mockKokoroVoiceId ou id réel préfixé côté route API).
  const isKokoroVoice = Boolean(params.voice?.startsWith('mock-kokoro-voice-') || params.voice?.startsWith('kokoro-'));
  // ElevenLabs PREMIUM (P153) : gating explicite. `params.plan` absent →
  // rétrocompatible (autorisé, comportement pré-P153) — voir doc du champ.
  const elevenLabsAllowed = params.plan === undefined || isElevenLabsAllowedForPlan(params.plan);
  // Kokoro compte comme provider exploitable même en voix STANDARD (repli
  // 1bis ci-dessous, resolveKokoroVoice fournit une voix par langue).
  const mock =
    cfg.MOCK_PROVIDERS ||
    (!modalAvailable && !qwen3Available && !edgeAvailable && !piperAvailable && !kokoroAvailable && !(elevenLabsAllowed && cfg.ELEVENLABS_API_KEY) && !cfg.OPENAI_API_KEY);

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

      // 0) Voix PREMIUM Chatterbox (Modal) et/ou Qwen3-TTS (Modal, ajout
      // additif 2026-07-22) — GPU, opt-in par variable d'env. Payantes :
      // tentées en premier uniquement si explicitement activées. Ordre
      // déterminé par `ttsEngine` (défaut : Chatterbox d'abord, comportement
      // INCHANGÉ — Qwen3 n'est qu'un repli supplémentaire ; 'qwen3' : Qwen3
      // d'abord). Échec des deux → cascade suivante (Edge/Piper/…). Blocs
      // dupliqués (pas de closure partagée) : une assignation à `provider`
      // depuis une fonction imbriquée n'est pas suivie par le contrôle de
      // flux TypeScript, ce qui élargirait `provider` de façon incorrecte
      // plus bas (narrationTempo).
      if (!audio && preferQwen3 && qwen3Available) {
        try {
          audio = await synthesizeQwen3Tts(text, locale, useClone ? params.voiceSampleB64 : undefined, params.context);
          provider = 'qwen3';
        } catch (err) {
          logger.warn({ err }, 'Qwen3-TTS indisponible — bascule vers le repli suivant');
        }
      }
      if (!audio && modalAvailable) {
        try {
          // Passe l'échantillon de clonage seulement si `useClone` (échantillon
          // fourni + Modal dispo) — sinon voix Chatterbox standard.
          audio = await synthesizeModalTts(text, locale, useClone ? params.voiceSampleB64 : undefined, params.context);
          provider = 'modal';
        } catch (err) {
          logger.warn({ err }, 'Modal TTS indisponible — bascule vers le repli suivant');
        }
      }
      if (!audio && !preferQwen3 && qwen3Available) {
        try {
          audio = await synthesizeQwen3Tts(text, locale, useClone ? params.voiceSampleB64 : undefined, params.context);
          provider = 'qwen3';
        } catch (err) {
          logger.warn({ err }, 'Qwen3-TTS indisponible — bascule vers le repli suivant');
        }
      }

      // 0bis) Voix neuronales Edge (gratuites, opt-in EDGE_TTS=true) — la
      // narration la plus HUMAINE disponible sans GPU ni clé payante : tentée
      // ensuite pour toute voix standard. Échec → cascade OSS inchangée.
      if (!audio && !isKokoroVoice && edgeAvailable) {
        try {
          audio = await synthesizeEdgeTts(text, locale, speed, params.edgeVoice);
          provider = 'edge';
        } catch (err) {
          logger.warn({ err }, 'Edge TTS indisponible — bascule vers le repli suivant');
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

      // 1bis) Kokoro en voix STANDARD (P153) — repli OSS quand Piper échoue ou
      // n'est pas joignable : resolveKokoroVoice fournit une voix par défaut
      // par langue (fr → ff_siwis), pas besoin de voix clonée. Sans ce repli,
      // un déploiement OSS sans Piper fonctionnel retombait en silence (mock)
      // alors qu'un moteur TTS local parfaitement utilisable tournait à côté.
      if (!audio && !isKokoroVoice && kokoroAvailable) {
        try {
          audio = await synthesizeKokoro(text, locale, undefined, speed);
          provider = 'kokoro';
        } catch (err) {
          logger.warn({ err }, 'Kokoro (voix standard) indisponible — bascule vers le repli suivant');
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
        // Dernier repli avant le silence : DOIT être tolérant aux erreurs comme
        // tous les autres moteurs de la cascade (correctif 2026-07-26). Sans ce
        // try/catch, un 401 OpenAI (clé sans le scope audio) était PROPAGÉ et
        // faisait ÉCHOUER tout le job TTS/audio-repair au lieu de retomber en
        // silence — bug révélé par la bascule de voix du cours due diligence.
        try {
          audio = await synthesizeOpenAi(text, cfg.OPENAI_API_KEY, speed);
          provider = 'openai';
        } catch (err) {
          logger.warn({ err }, 'OpenAI TTS indisponible — repli sur le silence');
        }
      }

      if (!audio) {
        // Aucun provider exploitable en pratique (quota/pannes partout) → silence réaliste.
        await synthesizeSilence(estimateNarrationSeconds(text, speed), normPath);
        provider = 'mock';
      } else {
        await writeFile(rawPath, audio);
        // Plafond de débit (voir narrationTempo) : Modal/Chatterbox n'a pas de
        // paramètre de vitesse natif → la vitesse auteur ET le plafond passent
        // par atempo ici ; les autres providers gèrent `speed` nativement, seul
        // le plafond de sécurité s'applique. Qwen3-TTS (ajout 2026-07-22) n'a
        // pas non plus de paramètre de vitesse natif (voir modal/qwen3_tts.py) —
        // même traitement que Modal/Chatterbox.
        const rawSeconds = await probeDurationSeconds(rawPath).catch(() => 0);
        const tempo = narrationTempo(text, rawSeconds, speed, provider !== 'modal' && provider !== 'qwen3');
        await normalizeLoudness(rawPath, normPath, tempo);
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
