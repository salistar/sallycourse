import pino from 'pino';

/**
 * Logger structuré du web (pino) — niveau piloté par LOG_LEVEL, JSON sur
 * stdout (collecté tel quel par Docker), champs sensibles caviardés.
 */

/** Chemins caviardés — mots de passe, tokens, clés et en-têtes d'auth. */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'key',
  '*.key',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
  'clientSecret',
  '*.clientSecret',
  'webhookSecret',
  '*.webhookSecret',
  'credentials',
  '*.credentials',
  // Phase 6 (avatar HeyGen + voice cloning ElevenLabs).
  'clonedVoiceId',
  '*.clonedVoiceId',
  'voiceId',
  '*.voiceId',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'headers.cookie',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'web' },
  redact: { paths: REDACTED_PATHS, censor: '[caviardé]' },
});

export type Logger = typeof logger;
