// Prompt 151 — wrapper TTSProvider autour de providers/piper-provider.ts
// (Prompt 153, OSS/défaut). ADDITIF : n'appelle QUE synthesizePiper, aucune
// logique dupliquée. Contrairement à tts-elevenlabs.ts (qui passe par la
// chaîne complète cache+repli de media/tts.ts), ce wrapper appelle Piper
// directement — jette une erreur explicite si PIPER_BASE_URL est absente
// (voir isPiperConfigured) : c'est au SÉLECTEUR (registry.ts) de ne choisir
// ce provider que lorsque l'OSS est effectivement pertinent, et à l'appelant
// de retomber sur un mock/silence si l'appel échoue malgré tout (même
// contrat que les autres providers : jamais d'échec bloquant du PIPELINE,
// mais CE wrapper isolé peut jeter — cohérent avec synthesizePiper lui-même).
import { synthesizePiper } from './piper-provider.js';
import type { TTSProvider, TTSProviderCallOptions, TTSProviderResult } from './types.js';

export const piperTTSProvider: TTSProvider = {
  name: 'piper',
  async synthesize(text: string, voice: string | undefined, opts: TTSProviderCallOptions = {}): Promise<TTSProviderResult> {
    const locale = opts.locale ?? 'fr';
    const speed = opts.speed ?? 1;
    const audioBuffer = await synthesizePiper(text, locale, voice, speed);
    // Piper ne renvoie pas la durée dans sa réponse HTTP — laissé à 0 ici,
    // à mesurer par l'appelant via ffprobe (probeDurationSeconds, media/tts.ts)
    // une fois le fichier écrit sur disque, comme pour les autres providers bruts.
    return { audioBuffer, seconds: 0 };
  },
};
