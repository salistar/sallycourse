// Clonage de voix OSS Kokoro (Prompt 153) — remplace XTTS pour P81. XTTS
// (Coqui) est publié sous licence Coqui Public Model License, NON commerciale :
// incompatible avec un SaaS payant (cf. note P161). Kokoro-82M est publié sous
// licence Apache 2.0 (usage commercial libre) : c'est le choix retenu ici pour
// le clonage de voix OSS, en complément d'ElevenLabs (option premium, cf.
// isElevenLabsAllowedForPlan ci-dessous et son branchement dans tts.ts).
//
// Déploiement possible : service FastAPI officiel (image
// ghcr.io/remsky/kokoro-fastapi-cpu, déclarée dans docker-compose profil `ai`,
// service `kokoro`) exposant une API compatible OpenAI TTS
// (`POST /v1/audio/speech`) + un endpoint de clonage par embedding de voix
// (`POST /v1/audio/voices` multipart, échantillon → voiceId réutilisable).
//
// MOCK_PROVIDERS ou KOKORO_BASE_URL absente → mode mock déterministe (id
// fictif stable + silence de synthèse), même contrat que voice-clone.ts.
import { createHash } from 'node:crypto';
import { getConfig } from '../shared.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { PLANS, type PlanId } from '@sallycourse/shared';

/** Voix Kokoro par défaut selon la langue (voix multilingues du modèle 82M). */
export const KOKORO_DEFAULT_VOICES: Record<string, string> = {
  fr: 'ff_siwis',
  en: 'af_heart',
  // Pas de voix arabe dédiée dans le jeu Kokoro officiel au 2026-07 — repli EN
  // (voix la plus stable) plutôt qu'un échec.
  ar: 'af_heart',
};
const KOKORO_FALLBACK_VOICE = KOKORO_DEFAULT_VOICES.en!;

/** Voix Kokoro effective pour une langue (voix forcée/clonée prioritaire si fournie). */
export function resolveKokoroVoice(locale: string, voice?: string): string {
  if (voice && voice.trim()) return voice.trim();
  return KOKORO_DEFAULT_VOICES[locale] ?? KOKORO_FALLBACK_VOICE;
}

/** URL de base Kokoro, surchargeable (.env / mock-server en test). */
function kokoroBaseUrl(): string | undefined {
  const raw = getConfig().KOKORO_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : undefined;
}

/** true si un endpoint Kokoro est configuré ET que le mode mock global n'est pas actif. */
export function isKokoroConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && Boolean(kokoroBaseUrl());
}

/**
 * ElevenLabs devient l'option PREMIUM (P153) : plans payants uniquement.
 * `free` n'a accès qu'aux providers OSS (Piper/Kokoro) — jamais à ElevenLabs,
 * même si une clé ELEVENLABS_API_KEY est configurée globalement (elle sert
 * alors uniquement aux plans pro/business).
 */
export function isElevenLabsAllowedForPlan(plan: PlanId | string | null | undefined): boolean {
  const resolved: PlanId = plan && plan in PLANS ? (plan as PlanId) : 'free';
  return resolved !== 'free';
}

// ── Clonage de voix (remplaçant OSS de voice-clone.ts pour le plan Free) ──

export interface CreateKokoroVoiceResult {
  /** Identifiant de la voix (Kokoro réel, ou fictif déterministe en mock). */
  voiceId: string;
  /** true si produit par un vrai appel Kokoro, false en mock. */
  live: boolean;
}

/** Id de voix fictif déterministe (mock) — stable pour un même (userId, label). */
export function mockKokoroVoiceId(userId: string, label: string): string {
  const hash = createHash('sha256').update(`kokoro-voice-clone:${userId}:${label}`).digest('hex');
  return `mock-kokoro-voice-${hash.slice(0, 24)}`;
}

/**
 * Crée une voix clonée via Kokoro à partir d'un échantillon audio. Même
 * contrat que voice-clone.ts (ElevenLabs) : aucune validation de durée/
 * consentement ici, c'est la responsabilité de l'appelant (route API).
 */
export async function createKokoroClonedVoice(
  userId: string,
  sampleAudioBuffer: Buffer,
  label: string,
): Promise<CreateKokoroVoiceResult> {
  const base = kokoroBaseUrl();
  const cfg = getConfig();
  const mock = cfg.MOCK_PROVIDERS || !base;

  if (mock) {
    return { voiceId: mockKokoroVoiceId(userId, label), live: false };
  }

  const form = new FormData();
  form.append('name', label);
  form.append('file', new Blob([new Uint8Array(sampleAudioBuffer)], { type: 'audio/mpeg' }), 'sample.mp3');

  const res = await fetch(`${base}/v1/audio/voices`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Kokoro voices ${res.status} : ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) {
    throw new Error('Kokoro voices : réponse sans voice_id');
  }
  return { voiceId: data.voice_id, live: true };
}

/**
 * Synthèse Kokoro (mp3/wav brut, réencodé/normalisé ensuite par tts.ts).
 * Jette une erreur explicite en cas d'échec HTTP.
 */
export async function synthesizeKokoro(text: string, locale: string, voice: string | undefined, speed: number): Promise<Buffer> {
  const base = kokoroBaseUrl();
  if (!base) {
    throw new Error('Kokoro : KOKORO_BASE_URL non configurée');
  }
  const kokoroVoice = resolveKokoroVoice(locale, voice);

  const res = await fetch(`${base}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice: kokoroVoice,
      response_format: 'mp3',
      speed,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Kokoro ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
