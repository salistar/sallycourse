// Gestion d'erreurs standardisée (Prompt 119). AppError est la classe de base
// commune à toute erreur métier/technique qui doit remonter jusqu'à
// l'utilisateur (API routes, processors worker) avec un message distinct pour
// l'utilisateur et pour les logs, un statut HTTP et un indicateur "retryable"
// exploitable par les appelants (retry automatique, bouton "réessayer"...).
//
// Ceci NE remplace PAS les erreurs déjà existantes (ClaudeJsonError,
// CircuitOpenError, StorageError, CourseCancelledError, VideoRenderError,
// DockerUnavailableError, UdemyCaptchaError, UdemySessionExpiredError,
// KajabiSessionExpiredError, ScreenshotCaptureError, AvatarGenerationError) :
// ces classes restent `extends Error` telles quelles pour ne rien casser des
// usages actuels (instanceof, catch ciblés, tests). AppError est disponible
// pour les NOUVELLES erreurs applicatives qui veulent un contrat standard, et
// les erreurs existantes peuvent migrer vers `extends AppError` plus tard,
// au cas par cas, sans urgence.

/** Code machine stable — utilisé pour brancher une logique côté appelant (i18n, retry, alerting). */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'STORAGE_ERROR'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  /** Message technique pour les logs — jamais affiché à l'utilisateur. */
  technicalMessage?: string;
  /** Rejouable tel quel par l'appelant (retry automatique ou bouton "réessayer"). */
  retryable?: boolean;
  /** Statut HTTP à renvoyer si l'erreur traverse une route API (défaut : 500). */
  httpStatus?: number;
  /** Erreur d'origine (chaînée via `cause`, pour la stack trace complète). */
  cause?: unknown;
}

const DEFAULT_HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EXTERNAL_SERVICE_ERROR: 502,
  STORAGE_ERROR: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Erreur applicative standardisée : sépare le message destiné à l'utilisateur
 * (`userMessage`, sûr à afficher tel quel dans un toast/une réponse JSON) du
 * message technique (`technicalMessage`, réservé aux logs structurés).
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly technicalMessage: string;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(code: AppErrorCode, userMessage: string, options: AppErrorOptions = {}) {
    // `message` (Error.message) porte le technique : c'est ce qui apparaît dans
    // les logs/traces par défaut, jamais renvoyé tel quel au client.
    super(options.technicalMessage ?? userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalMessage = options.technicalMessage ?? userMessage;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? DEFAULT_HTTP_STATUS[code];
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** True si `err` est une AppError (garde de type utilisable après un catch (err: unknown)). */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Normalise n'importe quelle erreur catchée en AppError, pour uniformiser le
 * traitement en bout de chaîne (route API, processor worker) sans perdre le
 * message d'origine. Une AppError déjà typée est retournée telle quelle.
 */
export function toAppError(err: unknown, fallbackUserMessage = 'Une erreur est survenue.'): AppError {
  if (isAppError(err)) return err;
  const technicalMessage = err instanceof Error ? err.message : String(err);
  return new AppError('INTERNAL_ERROR', fallbackUserMessage, { technicalMessage, cause: err });
}
