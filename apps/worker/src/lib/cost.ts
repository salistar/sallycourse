// Instrumentation des coûts de génération (Prompt 55). recordCost(...) écrit un
// CostRecord par appel facturable, en estimant l'USD via la table de tarifs
// partagée. userId est résolu depuis le cours si absent (dénormalisation pour
// agréger par plan sans jointure). Best-effort : un échec d'enregistrement ne
// doit jamais faire échouer la génération — on log et on continue.
import { Types } from 'mongoose';
import {
  Course,
  CostRecord,
  avatarCostUsd,
  claudeCostUsd,
  ttsCostUsdForProvider,
  renderCostUsd,
  imageCostUsd,
  transcribeCostUsd,
  type CostKind,
  type ProviderMix,
} from '../shared.js';
import { logger } from '../queues/index.js';

/** Contexte commun : à quel cours (et propriétaire) rattacher le coût. */
export interface CostContext {
  courseId: string;
  /** Propriétaire — résolu depuis le cours si omis. */
  userId?: string;
}

/** Cache local courseId → userId pour éviter un findById par appel Claude. */
const userIdCache = new Map<string, string>();

/** Résout le propriétaire d'un cours (avec cache mémoire). */
async function resolveUserId(courseId: string, userId?: string): Promise<string | null> {
  if (userId) return userId;
  const cached = userIdCache.get(courseId);
  if (cached) return cached;
  try {
    const course = await Course.findById(courseId).select('userId').lean();
    const owner = course?.userId ? String(course.userId) : null;
    if (owner) userIdCache.set(courseId, owner);
    return owner;
  } catch (err) {
    logger.warn({ courseId, err }, 'recordCost : résolution du propriétaire impossible');
    return null;
  }
}

/** Vide le cache courseId→userId (tests). */
export function resetCostCacheForTests(): void {
  userIdCache.clear();
}

interface RecordCostInput extends CostContext {
  kind: CostKind;
  estimatedUsd: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  chars?: number;
  seconds?: number;
}

/** Écrit un CostRecord (best-effort). Retourne l'USD estimé pour info. */
async function persist(input: RecordCostInput): Promise<number> {
  const owner = await resolveUserId(input.courseId, input.userId);
  if (!owner) return input.estimatedUsd;
  try {
    await CostRecord.create({
      courseId: new Types.ObjectId(input.courseId),
      userId: new Types.ObjectId(owner),
      kind: input.kind,
      estimatedUsd: input.estimatedUsd,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
      ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
      ...(input.chars !== undefined ? { chars: input.chars } : {}),
      ...(input.seconds !== undefined ? { seconds: input.seconds } : {}),
    });
  } catch (err) {
    logger.warn({ courseId: input.courseId, kind: input.kind, err }, 'recordCost : écriture échouée');
  }
  return input.estimatedUsd;
}

/** Enregistre le coût d'un appel Claude (tokens in/out). */
export async function recordClaudeCost(
  ctx: CostContext,
  model: string,
  tokensIn: number,
  tokensOut: number,
): Promise<number> {
  const estimatedUsd = claudeCostUsd(model, tokensIn, tokensOut);
  return persist({ ...ctx, kind: 'claude', model, tokensIn, tokensOut, estimatedUsd });
}

/** Enregistre le coût d'une synthèse vocale (caractères), selon le provider réel. */
export async function recordTtsCost(
  ctx: CostContext,
  chars: number,
  model = 'elevenlabs',
): Promise<number> {
  const estimatedUsd = ttsCostUsdForProvider(model, chars);
  return persist({ ...ctx, kind: 'tts', model, chars, estimatedUsd });
}

/**
 * Enregistre le coût d'un appel LLM CLOUD OpenAI-compatible (Gemini, DeepSeek,
 * Qwen, Kimi, Grok, GLM, MiniMax, Cloudflare). Comme les appels Claude, mais le
 * `model` porte l'identifiant du modèle cloud (→ pricing-table le connaît, les
 * modèles gratuits reviennent à 0). Rangé sous kind='claude' pour rester dans la
 * même famille « génération de texte » du dashboard, avec le modèle comme clé
 * de ventilation par provider.
 */
export async function recordCloudLlmCost(
  ctx: CostContext,
  model: string,
  tokensIn: number,
  tokensOut: number,
): Promise<number> {
  const estimatedUsd = claudeCostUsd(model, tokensIn, tokensOut);
  return persist({ ...ctx, kind: 'claude', model, tokensIn, tokensOut, estimatedUsd });
}

/** Enregistre le coût d'un rendu vidéo (secondes produites). */
export async function recordRenderCost(ctx: CostContext, seconds: number): Promise<number> {
  const estimatedUsd = renderCostUsd(seconds);
  return persist({ ...ctx, kind: 'render', model: 'ffmpeg', seconds, estimatedUsd });
}

/**
 * Enregistre le coût d'une génération d'image (nb d'images, défaut 1).
 * `model` (audit coûts 2026-07-26, additif) : moteur réellement utilisé
 * ('sdxl' | 'zimage') — sans lui, le dashboard ne pouvait pas ventiler les
 * images par app Modal. Absent → comportement historique (ligne sans modèle).
 */
export async function recordImageCost(ctx: CostContext, units = 1, model?: string): Promise<number> {
  const estimatedUsd = imageCostUsd(units);
  return persist({ ...ctx, kind: 'image', ...(model ? { model } : {}), estimatedUsd });
}

/**
 * Enregistre le coût d'une transcription Whisper (audit coûts 2026-07-26 —
 * jusqu'ici, l'usage Whisper n'était PAS instrumenté). `seconds` = durée de
 * l'audio transcrit.
 */
export async function recordTranscribeCost(ctx: CostContext, audioSeconds: number): Promise<number> {
  const estimatedUsd = transcribeCostUsd(audioSeconds);
  return persist({ ...ctx, kind: 'transcribe', model: 'whisper', seconds: audioSeconds, estimatedUsd });
}

/**
 * Enregistre le coût d'un segment avatar Ditto (audit coûts 2026-07-26 —
 * jusqu'ici, l'usage avatar n'était PAS instrumenté). `videoSeconds` = durée
 * du segment produit ; `model` = provider réel ('ditto' | 'sadtalker' | 'heygen').
 */
export async function recordAvatarCost(ctx: CostContext, videoSeconds: number, model = 'ditto'): Promise<number> {
  const estimatedUsd = avatarCostUsd(videoSeconds);
  return persist({ ...ctx, kind: 'avatar', model, seconds: videoSeconds, estimatedUsd });
}

/**
 * Enregistre le mix de providers RÉELLEMENT utilisé pour une famille donnée
 * (llm/tts/image) sur Course.providerMix (Prompt 160, comparateur de coût).
 * Best-effort : merge additif sur le champ existant (ne réinitialise pas les
 * autres familles déjà enregistrées) — un échec n'interrompt jamais la
 * génération, seulement loggé.
 */
export async function recordProviderChoice(
  courseId: string,
  family: keyof ProviderMix,
  choice: ProviderMix[keyof ProviderMix],
): Promise<void> {
  try {
    await Course.updateOne({ _id: courseId }, { $set: { [`providerMix.${family}`]: choice } });
  } catch (err) {
    logger.warn({ courseId, family, choice, err }, 'recordProviderChoice : écriture échouée');
  }
}
