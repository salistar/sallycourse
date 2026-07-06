import { z } from 'zod';

// Configuration centralisée : validation Zod des variables d'environnement.
// Lazy + cache : la validation n'a lieu qu'au premier appel de getConfig().
// Pour les clés optionnelles devenues indispensables : requireConfig('CLE').

/** Booléen tolérant pour les .env : "true"/"1"/"yes"/"on" → true, le reste → false. */
const envBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}, z.boolean());

/** Clé maître AES-256 : 32 octets encodés en hexadécimal (64 caractères). */
const masterKeySchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{64}$/,
    'doit contenir exactement 64 caractères hexadécimaux (32 octets — générer via `openssl rand -hex 32`)',
  );

export const envSchema = z.object({
  // ── Base ──────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url('doit être une URL valide (ex: http://localhost:3000)'),

  // ── Données ───────────────────────────────────────────────────
  MONGO_URI: z.string().min(1, 'URI MongoDB requise'),
  REDIS_URL: z.string().min(1, 'URL Redis requise'),

  // ── Stockage S3/MinIO ─────────────────────────────────────────
  S3_ENDPOINT: z.string().url('doit être une URL valide (ex: http://localhost:9000)'),
  S3_ACCESS_KEY: z.string().min(1, "clé d'accès S3 requise"),
  S3_SECRET_KEY: z.string().min(1, 'clé secrète S3 requise'),
  S3_BUCKET: z.string().min(1, 'nom de bucket requis'),
  S3_REGION: z.string().min(1, 'région S3 requise'),

  // ── Auth ──────────────────────────────────────────────────────
  AUTH_SECRET: z.string().min(16, 'doit faire au moins 16 caractères (générer via `openssl rand -base64 32`)'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // ── IA / providers ────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  MOCK_PROVIDERS: envBoolean.default(false),

  // ── Chiffrement des credentials plateformes ───────────────────
  CREDENTIALS_MASTER_KEY: masterKeySchema,

  // ── Email ─────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_URL: z.string().min(1).optional(),

  // ── Paiements ─────────────────────────────────────────────────
  CMI_MERCHANT_ID: z.string().min(1).optional(),
  CMI_STORE_KEY: z.string().min(1).optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

/** Les .env laissent souvent des valeurs vides ("CLE=") : on les traite comme absentes. */
function stripEmpty(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * Valide et retourne la configuration (parse unique, résultat mis en cache).
 * En cas d'échec, l'erreur liste chaque variable invalide avec sa raison.
 */
export function getConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  if (cachedConfig) return cachedConfig;

  const result = envSchema.safeParse(stripEmpty(env));
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide — variables d'environnement en erreur :\n${details}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/** Réinitialise le cache (tests, ou après mutation de process.env). */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Exige une clé optionnelle au moment de l'usage : jette une erreur explicite
 * si elle est absente, sinon retourne sa valeur non nulle.
 */
export function requireConfig<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
  const value = getConfig()[key];
  if (value === undefined || value === null) {
    throw new Error(
      `Variable d'environnement requise mais absente : ${String(key)}. ` +
        'Renseignez-la dans votre .env (voir .env.example).',
    );
  }
  return value as NonNullable<AppConfig[K]>;
}
