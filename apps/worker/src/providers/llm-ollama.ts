// Prompt 151 — wrapper LLMProvider autour de providers/ollama-provider.ts
// (Prompt 152). ADDITIF : ne modifie pas callOllamaJson, l'enveloppe pour
// satisfaire l'interface commune. `critical` reste accessible en 3e paramètre
// « caché » via opts.model (non — voir note) : ce wrapper couvre le cas
// standard (non critique) ; les appelants qui ont besoin de forcer le cloud
// direct (plan/scripts, cf. en-tête ollama-provider.ts) continuent d'appeler
// callOllamaJson({ critical: true, ... }) directement, ce wrapper ne retire
// aucune capacité existante.
import type { z } from 'zod';
import { callOllamaJson } from './ollama-provider.js';
import type { LLMProvider, LLMProviderCallOptions } from './types.js';

export const ollamaLLMProvider: LLMProvider = {
  name: 'ollama',
  generateJson<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    system: string,
    user: string,
    opts: LLMProviderCallOptions = {},
  ): Promise<T> {
    return callOllamaJson({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- voir CallOllamaJsonParams.schema (ollama-provider.ts)
      schema: schema as z.ZodType<T, z.ZodTypeDef, any>,
      system,
      user,
      model: opts.model,
      temperature: opts.temperature,
    });
  },
};
