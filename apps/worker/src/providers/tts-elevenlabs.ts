// Prompt 151 — wrapper TTSProvider autour de media/tts.ts::synthesizeSlide
// (chaîne complète cache→OSS→ElevenLabs→OpenAI→silence, Prompts 23/153).
// ADDITIF : n'appelle QUE synthesizeSlide, aucune logique dupliquée. Le nom
// "elevenlabs" reflète l'usage attendu (provider CLOUD premium sélectionné
// par registry.ts) même si synthesizeSlide gère en interne tout le reste de
// la chaîne de repli (déjà mock-friendly).
import { getObjectStream } from '../shared.js';
import { synthesizeSlide } from '../media/tts.js';
import type { TTSProvider, TTSProviderCallOptions, TTSProviderResult } from './types.js';

/** Lit un stream S3 en Buffer complet (même logique que media/tts.ts::streamToBuffer, non exportée). */
async function streamToBuffer(key: string): Promise<Buffer> {
  const stream = await getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const elevenLabsTTSProvider: TTSProvider = {
  name: 'elevenlabs',
  async synthesize(text: string, voice: string | undefined, opts: TTSProviderCallOptions = {}): Promise<TTSProviderResult> {
    const result = await synthesizeSlide({
      text,
      locale: opts.locale ?? 'fr',
      voice,
      speed: opts.speed,
      // Ce wrapper N'est sélectionné par registry.ts que lorsque le plan
      // justifie le cloud (pro/business, cf. planJustifiesCloud) — 'business'
      // ouvre systématiquement l'accès ElevenLabs côté isElevenLabsAllowedForPlan.
      plan: 'business',
    });
    // synthesizeSlide stocke déjà le résultat en cache S3 (cacheKey) — on relit
    // le buffer pour respecter le contrat TTSProvider (audioBuffer en mémoire).
    const audioBuffer = await streamToBuffer(result.cacheKey);
    return { audioBuffer, seconds: result.seconds };
  },
};
