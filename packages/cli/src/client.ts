import type { CliConfig } from './config.js';

// Client HTTP mince pour l'API publique v1 : ajoute l'auth Bearer et parse la
// réponse JSON. Le fetch global de Node 18+ est utilisé (aucune dépendance).

/** Erreur enrichie d'un statut HTTP et du corps de réponse (pour l'affichage). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Compose l'URL absolue d'un chemin d'API relatif (ex. /api/v1/courses). */
export function apiUrl(config: CliConfig, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${config.apiUrl}${suffix}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** fetch injectable pour les tests ; défaut = fetch global. */
  fetchImpl?: typeof fetch;
}

/**
 * Émet une requête authentifiée et retourne le JSON typé. Jette ApiError sur un
 * statut >= 400 avec le message d'erreur serveur si présent.
 */
export async function apiRequest<T = unknown>(
  config: CliConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await doFetch(apiUrl(config, path), { method, headers, body: payload });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Requête réseau échouée : ${reason}`, 0, null);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const serverMsg =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new ApiError(serverMsg, response.status, parsed);
  }

  return parsed as T;
}
