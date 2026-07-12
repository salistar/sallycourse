// Prompt 151 — interfaces communes des providers abstraits du pipeline.
//
// Objectif : découpler CHAQUE étape de génération (texte structuré, voix,
// image, stockage, email) de son implémentation concrète (cloud payant OU
// OSS auto-hébergé), pour pouvoir choisir/basculer sans toucher aux
// générateurs métier (generators/*.ts). Le choix effectif se fait dans
// registry.ts (selectProvider) ; CE fichier ne fait QUE définir le contrat.
//
// Chaque implémentation concrète (déjà existante ou à venir) doit rester
// MOCK-FRIENDLY : jamais d'échec bloquant si le service local n'est pas
// démarré — toujours un repli documenté (mock déterministe ou cloud si
// configuré), à l'image de callClaudeJson (lib/claude.ts) et synthesizeSlide
// (media/tts.ts) qui gèrent déjà ce comportement en interne.
import type { z } from 'zod';

/** Identifie la famille de provider concernée (pour le registre + les logs/coûts). */
export type ProviderKind = 'llm' | 'tts' | 'image' | 'storage' | 'email';

/**
 * Générateur de JSON structuré validé par schéma Zod (texte : plan de cours,
 * article, quiz, script vidéo, marketing…). Implémenté aujourd'hui par :
 *   - lib/claude.ts::callClaudeJson (cloud, Anthropic) — voir llm-claude.ts.
 *   - providers/ollama-provider.ts::callOllamaJson (OSS local, Ollama) —
 *     câblage LLMProvider dédié laissé à une prochaine itération : le
 *     wrapper llm-claude.ts couvre le cloud, ollama-provider.ts reste
 *     appelable directement par les générateurs qui ont déjà besoin de son
 *     option `critical` (voir son en-tête, Prompt 152).
 */
export interface LLMProvider {
  /** Nom court du provider (logs, coûts, tests). */
  readonly name: string;
  generateJson<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    system: string,
    user: string,
    opts?: LLMProviderCallOptions,
  ): Promise<T>;
}

export interface LLMProviderCallOptions {
  /** Modèle forcé (sinon défaut du provider). */
  model?: string;
  /** Budget de tokens de sortie. */
  maxTokens?: number;
  /** Température (certains modèles récents rejettent les valeurs non défaut). */
  temperature?: number;
  /** Désactive le cache pour cet appel (retry métier avec feedback réinjecté). */
  skipCache?: boolean;
}

/**
 * Synthèse vocale : texte → audio. Implémenté aujourd'hui par :
 *   - media/tts.ts::synthesizeSlide (chaîne complète cache→OSS→cloud→silence)
 *     — voir tts-elevenlabs.ts (wrapper cloud) et le OSS déjà présent dans
 *     providers/piper-provider.ts / providers/kokoro-provider.ts (Prompt 153).
 */
export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, voice: string | undefined, opts?: TTSProviderCallOptions): Promise<TTSProviderResult>;
}

export interface TTSProviderCallOptions {
  /** Langue de la narration (fr/en/ar) — choisit la voix par défaut. */
  locale?: string;
  /** Vitesse de narration (0.75–1.25, Course.narrationSpeed). */
  speed?: number;
}

export interface TTSProviderResult {
  /** Audio brut produit (mp3/wav selon le provider — normalisé en aval par tts.ts). */
  audioBuffer: Buffer;
  /** Durée estimée ou mesurée, en secondes (mesure exacte laissée à probeDurationSeconds côté appelant). */
  seconds: number;
}

/**
 * Génération d'image (couverture, visuel marketing, illustration de slide).
 * Implémentations :
 *   - image-svg.ts (OSS/défaut) — motif procédural déterministe, aucune
 *     dépendance externe (packages/design/marketing-assets.ts existant).
 *   - image-comfyui.ts (OSS auto-hébergé, GPU) — Prompt 154, non couvert ici.
 *   - image-cloud.ts (cloud, à configurer) — mock déterministe tant qu'aucun
 *     provider cloud n'est câblé (respecte MOCK-FRIENDLY : jamais bloquant).
 */
export interface ImageProvider {
  readonly name: string;
  generate(prompt: string, opts?: ImageProviderCallOptions): Promise<Buffer>;
}

export interface ImageProviderCallOptions {
  /** Format cible (dimensions) — voir marketingFormats (packages/design). */
  format?: 'udemy' | 'youtube' | 'og' | 'story';
  /** Langue d'affichage (RTL pour l'arabe). */
  lang?: 'fr' | 'en' | 'ar';
  /** Seed déterministe (reproductibilité) — sinon dérivée du prompt. */
  seed?: string;
}

/**
 * Stockage objet (S3/MinIO) — DÉJÀ couvert par @sallycourse/shared/storage
 * (getS3Client, uploadObject, getObjectStream, objectExists, storageKeys,
 * presignedUrl, deleteCoursePrefix…). On ne recrée PAS d'interface ici : ce
 * module fait référence, documente le mapping vers un StorageProvider pour
 * que le registre (registry.ts) reste homogène avec les autres kinds.
 *
 * Mapping StorageProvider → storage.ts existant :
 *   - upload(key, body, contentType)   → uploadObject(key, body, contentType)
 *   - download(key)                    → getObjectStream(key)
 *   - exists(key)                      → objectExists(key)
 *   - presignedUrl(key, ttlSec)        → presignedUrl(key, ttlSec) (voir storage.ts)
 *   - deletePrefix(prefix)             → deleteCoursePrefix(courseId) (spécialisé cours)
 * Un seul provider aujourd'hui (S3/MinIO) : pas d'alternative OSS à
 * sélectionner (MinIO EST déjà la brique OSS auto-hébergée par défaut du
 * docker-compose profil core/full — AWS S3 réel reste une bascule de config,
 * pas un provider distinct côté code).
 */
export type StorageProvider = never;

/**
 * Envoi d'email transactionnel (séquences post-inscription, notifications).
 * Implémentations :
 *   - email-smtp.ts (OSS/défaut) — SMTP_URL (ex. mailpit en dev, tout relai
 *     SMTP standard en prod auto-hébergé) ; absent → mock (log, aucun envoi).
 *   - email-resend.ts (cloud) — RESEND_API_KEY ; absente → mock.
 */
export interface EmailProvider {
  readonly name: string;
  send(to: string, subject: string, html: string): Promise<void>;
}
