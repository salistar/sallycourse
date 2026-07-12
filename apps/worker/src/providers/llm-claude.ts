// Prompt 151 — wrapper LLMProvider autour de lib/claude.ts::callClaudeJson.
// ADDITIF : ne modifie pas callClaudeJson, l'enveloppe simplement pour
// satisfaire l'interface commune (voir providers/types.ts). Le comportement
// mock-friendly (MOCK_PROVIDERS / clé absente → fixture déterministe) reste
// entièrement délégué à callClaudeJson — rien n'est dupliqué ici.
import type { z } from 'zod';
import { callClaudeJson, DEFAULT_CLAUDE_MODEL } from '../lib/claude.js';
import type { LLMProvider, LLMProviderCallOptions } from './types.js';

export const claudeLLMProvider: LLMProvider = {
  name: 'claude',
  generateJson<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    system: string,
    user: string,
    opts: LLMProviderCallOptions = {},
  ): Promise<T> {
    return callClaudeJson({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- voir CallClaudeJsonParams.schema (claude.ts)
      schema: schema as z.ZodType<T, z.ZodTypeDef, any>,
      system,
      user,
      model: opts.model ?? DEFAULT_CLAUDE_MODEL,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      skipCache: opts.skipCache,
    });
  },
};
