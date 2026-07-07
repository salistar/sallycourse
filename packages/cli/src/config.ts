import { z } from 'zod';
import type { ParsedArgs } from './args.js';
import { optString } from './args.js';

// Résolution de la configuration client : URL de base de l'API et clé API.
// Priorité : flags (--api-url / --api-key) > variables d'environnement.

export interface CliConfig {
  /** URL de base de l'API publique v1, sans slash final (ex. https://app.tld). */
  apiUrl: string;
  /** Clé API (sk_live_...) présentée en Bearer. */
  apiKey: string;
}

const configSchema = z.object({
  apiUrl: z.string().url({ message: 'URL API invalide' }),
  apiKey: z.string().min(1, 'clé API manquante'),
});

/** Retire un éventuel slash final pour composer proprement les chemins. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Résout la config depuis les flags puis l'environnement. Jette un message clair
 * si l'URL ou la clé manque/est invalide (logique pure : env passé en argument).
 */
export function resolveConfig(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
): CliConfig {
  const apiUrl = optString(args, 'api-url') ?? env.SALLYCOURSE_API_URL ?? '';
  const apiKey = optString(args, 'api-key') ?? env.SALLYCOURSE_API_KEY ?? '';

  const parsed = configSchema.safeParse({
    apiUrl: normalizeBaseUrl(apiUrl),
    apiKey,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(' ; ');
    throw new Error(
      `Configuration invalide : ${issues}. Renseignez SALLYCOURSE_API_URL / SALLYCOURSE_API_KEY ` +
        `ou les flags --api-url / --api-key.`,
    );
  }

  return { apiUrl: normalizeBaseUrl(parsed.data.apiUrl), apiKey: parsed.data.apiKey };
}
