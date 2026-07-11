/**
 * Client API pur pour l'app mobile SallyCourse.
 *
 * Consomme l'API publique v1 (auth par clé API, Prompt 51) pour les cours, et
 * l'API session /api/notifications pour les notifications (Prompt 98 précise
 * de réutiliser GET /api/notifications existant — on l'appelle donc en passant
 * la même clé API en en-tête X-API-Key ; si le déploiement cible exige une
 * session cookie pour cette route, le fallback consiste à n'afficher que la
 * liste vide plutôt que de planter, cf. handleJsonResponse).
 *
 * Volontairement 100% fonctions pures / fetch injectable : aucune dépendance
 * React Native ici, testable sous Node classique (vitest).
 */

export interface ApiClientConfig {
  /** URL de base de l'API (ex: https://app.sallycourse.com). */
  baseUrl: string;
  /** Clé API SallyCourse (format sk_...), stockée côté device. */
  apiKey: string;
  /** Implémentation fetch injectable (par défaut globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type CourseStatus = 'draft' | 'pending' | 'generating' | 'ready' | 'failed' | 'cancelled';

export interface CourseSummary {
  id: string;
  title: string;
  difficulty: Difficulty;
  status: CourseStatus;
  locale: string;
  platforms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentStatus {
  platform: string;
  status: string;
  mode: string;
  externalUrl: string | null;
}

export interface CourseDetail extends CourseSummary {
  generation: { step: string; progress: number } | null;
  deployments: DeploymentStatus[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  unreadCount: number;
  notifications: NotificationItem[];
}

/** Erreur API typée — porte le code HTTP + le corps d'erreur renvoyé par le serveur. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Construit les en-têtes d'auth par clé API (Bearer, cf. requireApiKeyUser côté serveur). */
export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** Vérifie le format minimal d'une clé API avant de la persister (évite un aller-retour réseau inutile). */
export function looksLikeApiKey(value: string): boolean {
  return typeof value === 'string' && value.trim().length >= 10;
}

/** Construit l'URL absolue d'un chemin d'API relatif. */
export function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function handleJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errBody = (body ?? {}) as { error?: string; code?: string };
    throw new ApiError(
      response.status,
      errBody.error ?? `Erreur API (${response.status})`,
      errBody.code,
    );
  }

  return body as T;
}

/** Client API mobile — instancié une fois avec la config (baseUrl + clé) au login. */
export class SallyCourseClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  /** GET /api/v1/courses — liste des cours du porteur de la clé. */
  async listCourses(): Promise<CourseSummary[]> {
    const res = await this.fetchImpl(buildUrl(this.baseUrl, '/api/v1/courses'), {
      method: 'GET',
      headers: buildAuthHeaders(this.apiKey),
    });
    const data = await handleJsonResponse<{ courses: CourseSummary[] }>(res);
    return data.courses;
  }

  /** GET /api/v1/courses/[id] — détail + progression d'un cours. */
  async getCourse(id: string): Promise<CourseDetail> {
    const res = await this.fetchImpl(buildUrl(this.baseUrl, `/api/v1/courses/${id}`), {
      method: 'GET',
      headers: buildAuthHeaders(this.apiKey),
    });
    return handleJsonResponse<CourseDetail>(res);
  }

  /** GET /api/notifications — notifications in-app + compteur de non-lus. */
  async listNotifications(): Promise<NotificationsResponse> {
    const res = await this.fetchImpl(buildUrl(this.baseUrl, '/api/notifications'), {
      method: 'GET',
      headers: buildAuthHeaders(this.apiKey),
    });
    return handleJsonResponse<NotificationsResponse>(res);
  }

  /** Vérifie que la clé API est valide en tentant un appel léger (utilisé à l'écran Login). */
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.listCourses();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return false;
      throw err;
    }
  }
}

/** Intervalle de polling de la progression d'un cours en l'absence de SSE mobile (ms). */
export const COURSE_POLL_INTERVAL_MS = 5000;
