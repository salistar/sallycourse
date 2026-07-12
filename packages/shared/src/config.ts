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
  // Avatar vidéo (P82) — HeyGen choisi (API REST simple, statut de rendu
  // pollable, coût prévisible /min). Absente → mode mock (carte titre animée).
  HEYGEN_API_KEY: z.string().min(1).optional(),
  // TTS OSS (P153) — Piper (voix rapides CPU, plan Free) et Kokoro (clonage de
  // voix Apache-2.0, remplace XTTS pour P81). URLs surchageables (service local
  // docker-compose profil `ai`, ou déploiement dédié) ; absentes → mode mock
  // déterministe (silence), jamais d'échec bloquant du pipeline.
  PIPER_BASE_URL: z.string().min(1).optional(),
  KOKORO_BASE_URL: z.string().min(1).optional(),
  // LLM OSS local (P152, Phase 9) — Ollama. Absente → repli sur le mock
  // déterministe (mock-fixtures) ou l'escalade cloud si ANTHROPIC_API_KEY
  // existe, jamais d'échec bloquant du pipeline.
  OLLAMA_BASE_URL: z.string().min(1).optional(),
  // Surcharges des modèles recommandés par tâche (défauts documentés dans
  // worker/src/providers/ollama-provider.ts si absentes).
  OLLAMA_MODEL_CRITICAL: z.string().min(1).optional(),
  OLLAMA_MODEL_SIMPLE: z.string().min(1).optional(),
  // Force la détection GPU sans requête /api/tags (tests, CI, machine connue).
  OLLAMA_HAS_GPU: envBoolean.default(false),
  // Illustrations de slides OSS (P154) — ComfyUI (FLUX.1-schnell ou Stable
  // Diffusion, service GPU local, docker-compose profil `ai`). Absente → repli
  // SVG procédural du design system (packages/design/marketing-assets, P11/D11),
  // qui reste le comportement PAR DÉFAUT : ComfyUI n'est qu'une amélioration
  // optionnelle GPU, jamais un point de blocage du pipeline.
  COMFYUI_BASE_URL: z.string().min(1).optional(),
  // Avatar vidéo OSS (P155) — SadTalker, option PAR DÉFAUT devant HeyGen
  // (premium, plans payants uniquement — cf. isHeyGenAllowedForPlan dans
  // providers/sadtalker-provider.ts). GPU requis pour un temps de rendu
  // raisonnable : sans SADTALKER_HAS_GPU=true, on ne tente jamais l'appel
  // (rendu CPU inexploitable en pipeline) et on retombe sur le mock (carte
  // titre animée existante, D8), jamais un point de blocage du pipeline.
  SADTALKER_BASE_URL: z.string().min(1).optional(),
  SADTALKER_HAS_GPU: envBoolean.default(false),
  MOCK_PROVIDERS: envBoolean.default(false),
  // Prompt 151 — stratégie open-source-first : mode de sélection par défaut
  // lu par providers/registry.ts::selectProvider pour choisir entre une
  // implémentation OSS auto-hébergée (Ollama/Piper/Kokoro/ComfyUI/SMTP) et une
  // implémentation cloud payante (Claude/ElevenLabs/Resend…) :
  //   - 'oss'   : force toujours l'implémentation OSS (ignore les clés cloud).
  //   - 'cloud' : force toujours l'implémentation cloud (jette si clé absente
  //               — sauf mock global, voir registry.ts).
  //   - 'auto' (défaut) : OSS par défaut, bascule vers le cloud SEULEMENT si
  //               l'utilisateur a une clé cloud ET un plan qui la justifie
  //               (pro/business — free reste OSS, cf. isElevenLabsAllowedForPlan).
  PROVIDER_MODE: z.enum(['oss', 'cloud', 'auto']).default('auto'),
  // Recherche web basique pour la détection de plagiat sortant (P141, ex.
  // Brave Search). Absente → mode mock honnête (vérification skip, cf.
  // worker/lib/plagiarism-check.ts) — jamais d'appel réseau bloquant.
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),

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

  // ── Notifications push web (P156) ──────────────────────────────
  // Web Push natif (VAPID) — pas de Firebase/service tiers. Clé publique
  // (base64url, exposée au navigateur pour PushManager.subscribe) + clé privée
  // (signe le JWT VAPID des requêtes vers l'endpoint FCM/Mozilla, jamais
  // exposée). Générées par `scripts/generate-vapid-keys.mjs`. Absentes →
  // apps/web/src/lib/web-push.ts retombe en mode mock (aucun envoi réel).
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  // Contact affiché aux navigateurs par certains push services (obligatoire
  // pour Mozilla autopush) — un mailto: ou https:.
  VAPID_SUBJECT: z.string().min(1).default('mailto:notifications@sallycourse.app'),
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
