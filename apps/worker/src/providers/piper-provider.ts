// TTS OSS Piper (Prompt 153) — voix par défaut du plan Free (FR/EN, rapide, CPU).
//
// Choix d'implémentation : rhasspy/wyoming-piper (déclaré dans docker-compose,
// profil `ai`) expose le protocole Wyoming (binaire, TCP :10200) — pas du HTTP.
// Plutôt que ré-implémenter ce protocole en JS, on appelle un wrapper HTTP posé
// devant le même moteur Piper (image `lscr.io/linuxserver/piper`, service
// `piper-http` du docker-compose, PIPER_BASE_URL=http://localhost:10201 par
// défaut) qui expose une route REST simple `POST /api/text-to-speech` (texte +
// voix → wav/mp3 brut). Documenté ici pour ne pas confondre les deux services.
//
// MOCK_PROVIDERS ou PIPER_BASE_URL absente → silence déterministe (même
// contrat que media/tts.ts) : jamais d'échec bloquant du pipeline si le
// service local Piper n'est pas démarré.
import { getConfig } from '../shared.js';

/** Voix Piper par défaut selon la langue (modèles rhasspy/piper-voices officiels). */
export const PIPER_DEFAULT_VOICES: Record<string, string> = {
  fr: 'fr_FR-siwis-medium',
  en: 'en_US-lessac-medium',
  // Pas de modèle Piper arabe officiel stable au 2026-07 — repli sur la voix
  // multilingue la plus proche (FR) plutôt qu'un échec.
  ar: 'fr_FR-siwis-medium',
};
const PIPER_FALLBACK_VOICE = PIPER_DEFAULT_VOICES.en!;

/** Voix Piper effective pour une langue (voix forcée prioritaire si fournie). */
export function resolvePiperVoice(locale: string, voice?: string): string {
  if (voice && voice.trim()) return voice.trim();
  return PIPER_DEFAULT_VOICES[locale] ?? PIPER_FALLBACK_VOICE;
}

/** URL de base du wrapper HTTP Piper, surchargeable (.env / mock-server en test). */
function piperBaseUrl(): string | undefined {
  const raw = getConfig().PIPER_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : undefined;
}

/** true si un endpoint Piper est configuré ET que le mode mock global n'est pas actif. */
export function isPiperConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && Boolean(piperBaseUrl());
}

/**
 * Synthèse Piper (wav brut, réencodé/normalisé ensuite par tts.ts comme les
 * autres providers). Jette une erreur explicite en cas d'échec HTTP — c'est
 * l'appelant (tts.ts) qui décide du repli (OpenAI/silence), Piper n'a pas de
 * connaissance de la chaîne de repli globale.
 */
export async function synthesizePiper(text: string, locale: string, voice: string | undefined, speed: number): Promise<Buffer> {
  const base = piperBaseUrl();
  if (!base) {
    throw new Error('Piper : PIPER_BASE_URL non configurée');
  }
  const piperVoice = resolvePiperVoice(locale, voice);

  const res = await fetch(`${base}/api/text-to-speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: piperVoice,
      // length_scale inverse de la vitesse (Piper/eSpeak convention) : un débit
      // plus rapide (speed > 1) réduit la durée par phonème (length_scale < 1).
      length_scale: 1 / speed,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Piper ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
