// Voix neuronales Microsoft Edge (gratuites, service en ligne du navigateur
// Edge, sans clé API) — la demande produit : une narration « très humaine »
// sur une machine SANS GPU, là où les moteurs OSS locaux (Piper, Kokoro)
// restent perceptiblement synthétiques. Qualité équivalente aux voix Azure
// Neural. Trois langues du produit couvertes nativement.
//
// Positionnement dans la cascade TTS (media/tts.ts) : PREMIER choix pour une
// voix standard quand EDGE_TTS=true (opt-in .env — service cloud non-OSS,
// désactivé par défaut pour respecter la philosophie « OSS par défaut »),
// avant Piper/Kokoro. Jette en cas d'échec : l'appelant décide du repli.
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { getConfig } from '../shared.js';

/** Voix neuronale par langue du produit — surchargables via EDGE_TTS_VOICE_{FR,EN,AR}. */
export const EDGE_TTS_DEFAULT_VOICES: Record<string, string> = {
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-AriaNeural',
  ar: 'ar-SA-ZariyahNeural',
};

/** Repli si la locale n'est pas couverte explicitement. */
export const EDGE_TTS_FALLBACK_VOICE = 'en-US-AriaNeural';

/** true si les voix Edge sont activées (EDGE_TTS=true) et le mock global inactif. */
export function isEdgeTtsConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && process.env.EDGE_TTS?.trim().toLowerCase() === 'true';
}

/** Voix Edge effective pour une locale (surcharge .env prioritaire). */
export function resolveEdgeTtsVoice(locale: string): string {
  const override = process.env[`EDGE_TTS_VOICE_${locale.toUpperCase()}`]?.trim();
  if (override) return override;
  return EDGE_TTS_DEFAULT_VOICES[locale] ?? EDGE_TTS_FALLBACK_VOICE;
}

/**
 * Synthétise `text` en MP3 (24 kHz, mono) via les voix neuronales Edge.
 * `speed` suit la convention du pipeline (1 = débit standard) et est
 * traduite en prosodie `rate` (+/-%). `voiceOverride` (catalogue de voix,
 * fix « voix multiples » 2026-07-26) force une voix Edge précise — l'identité
 * SOURCE de la voix du cours — au lieu du défaut par langue ; absent →
 * comportement historique inchangé. Jette en cas d'échec réseau — le
 * repli (Piper/Kokoro/silence) appartient à l'appelant (media/tts.ts).
 */
export async function synthesizeEdgeTts(text: string, locale: string, speed: number, voiceOverride?: string): Promise<Buffer> {
  const voice = voiceOverride?.trim() || resolveEdgeTtsVoice(locale);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  const ratePercent = Math.round((speed - 1) * 100);
  const { audioStream } = tts.toStream(text, {
    rate: `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`,
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) throw new Error(`Edge TTS : flux audio vide (voix ${voice})`);
  return Buffer.concat(chunks);
}
