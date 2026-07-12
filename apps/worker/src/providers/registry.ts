// Prompt 151 — registre de sélection des providers : décide, pour chaque
// famille (llm/tts/image/email), quelle implémentation utiliser (OSS locale
// vs cloud payante) à partir de PROVIDER_MODE (packages/shared/src/config.ts)
// et du plan de l'utilisateur.
//
// Règle 'auto' (par défaut) : OSS par défaut, cloud SEULEMENT si une clé cloud
// existe ET que le plan la justifie (pro/business). `free` reste TOUJOURS sur
// l'OSS, même si une clé cloud globale est configurée (cohérent avec
// isElevenLabsAllowedForPlan dans providers/kokoro-provider.ts, Prompt 153).
//
// Ce module ne fait QUE décider ('oss' | 'cloud') — il n'appelle aucun
// provider lui-même : les générateurs métier consomment ensuite le résultat
// pour choisir la fonction concrète adaptée (voir llm-claude.ts / tts-*.ts).
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { PLANS, type PlanId } from '@sallycourse/shared';
import type { ProviderKind } from './types.js';

/** Décision de sélection retournée par selectProvider. */
export type ProviderChoice = 'oss' | 'cloud';

export interface SelectProviderContext {
  /** Plan de l'utilisateur (free/pro/business) — absent traité comme 'free' (prudent). */
  plan?: PlanId | string | null;
  /**
   * Présence d'une clé cloud exploitable pour CETTE famille de provider
   * (ANTHROPIC_API_KEY pour 'llm', ELEVENLABS_API_KEY pour 'tts', une clé
   * image cloud pour 'image', RESEND_API_KEY pour 'email'). Calculé par
   * l'appelant (registry n'a pas besoin de connaître le nom exact de chaque
   * variable d'env — reste indépendant d'un nouveau provider cloud ajouté).
   */
  hasCloudKey: boolean;
}

/** true si le plan donné justifie l'usage d'un provider cloud payant (pro/business uniquement). */
export function planJustifiesCloud(plan: PlanId | string | null | undefined): boolean {
  const resolved: PlanId = plan && plan in PLANS ? (plan as PlanId) : 'free';
  return resolved !== 'free';
}

/**
 * Choisit 'oss' ou 'cloud' pour la famille de provider donnée, selon
 * PROVIDER_MODE et le contexte (plan + présence de clé) :
 *   - 'oss'   : toujours OSS, quel que soit le contexte.
 *   - 'cloud' : toujours cloud (à l'appelant de gérer l'absence de clé —
 *               les implémentations concrètes retombent déjà en mock).
 *   - 'auto'  : cloud UNIQUEMENT si (clé cloud présente ET plan pro/business),
 *               sinon OSS.
 * MOCK_PROVIDERS=true ne change PAS la décision ici (le choix OSS/cloud reste
 * indépendant du mock) : c'est CHAQUE implémentation concrète qui court-circuite
 * en mock déterministe si son propre endpoint/clé est absent (déjà le cas pour
 * callClaudeJson, synthesizeSlide, ollama-provider, piper-provider, etc.).
 */
export function selectProvider(kind: ProviderKind, ctx: SelectProviderContext): ProviderChoice {
  const { PROVIDER_MODE } = getConfig();

  const decide = (): ProviderChoice => {
    if (PROVIDER_MODE === 'oss') return 'oss';
    if (PROVIDER_MODE === 'cloud') return 'cloud';
    // 'auto' : cloud seulement si clé dispo ET plan qui la justifie.
    return ctx.hasCloudKey && planJustifiesCloud(ctx.plan) ? 'cloud' : 'oss';
  };

  const choice = decide();
  logger.debug({ kind, mode: PROVIDER_MODE, plan: ctx.plan ?? 'free', hasCloudKey: ctx.hasCloudKey, choice }, 'selectProvider');
  return choice;

  // `kind` n'influence pas encore la règle (même logique pour toutes les
  // familles aujourd'hui) — gardé dans la signature pour permettre une règle
  // spécifique par famille plus tard (ex. 'image' toujours OSS tant qu'aucun
  // provider cloud n'est câblé) sans casser les appelants existants.
}
