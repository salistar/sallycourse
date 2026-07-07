// Table de tarifs des providers — source unique et éditable pour l'estimation
// des coûts de génération (Prompt 55). Tous les prix sont documentés et datés ;
// mets-les à jour ici quand un provider change sa grille. Aucune dépendance :
// ce module est importé côté worker (calcul) ET côté web (dashboard marges).

/** Type de coût enregistré (aligné sur CostRecord.kind côté db). */
export type CostKind = 'claude' | 'tts' | 'render' | 'image';

/**
 * Tarifs Claude par modèle, en USD par MILLION de tokens (in / out).
 * Réf. grille Anthropic (platform.claude.com/docs — models/overview), 2026-07.
 * Le pipeline utilise claude-sonnet-5 par défaut (DEFAULT_CLAUDE_MODEL) ;
 * les autres entrées couvrent d'éventuelles surcharges de modèle.
 */
export const CLAUDE_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Modèle de repli si le modèle facturé n'est pas dans la table ci-dessus. */
export const CLAUDE_FALLBACK_MODEL = 'claude-sonnet-5';

/**
 * Tarif ElevenLabs : facturation au caractère synthétisé.
 * Réf. plan Creator ≈ 22 USD / 100 000 crédits (1 crédit ≈ 1 caractère),
 * soit 0,00022 USD/caractère. 2026-07 — ajuster selon le plan réel.
 */
export const TTS_USD_PER_CHAR = 0.00022;

/**
 * Estimation compute du rendu vidéo (ffmpeg) : coût machine par seconde de
 * vidéo produite. Pas de facturation externe — approximation d'un vCPU cloud
 * (~0,05 USD/h ⇒ ~0,0000139 USD/s), majorée pour l'encodage H.264 1080p.
 * Éditable : reflète le coût d'infrastructure réel du worker.
 */
export const RENDER_USD_PER_SECOND = 0.00003;

/**
 * Génération d'image (couverture, visuels marketing) : coût forfaitaire par
 * image. Réf. ordre de grandeur d'un provider image (~0,04 USD/image). 2026-07.
 */
export const IMAGE_USD_PER_UNIT = 0.04;

/**
 * Revenu mensuel par plan, en EUR (aligné sur la page /pricing).
 * Sert au calcul de marge (revenu plan − coût des cours du plan) dans le
 * dashboard admin. free = 0 (pas de revenu direct).
 */
export const PLAN_REVENUE_EUR_PER_MONTH: Record<string, number> = {
  free: 0,
  pro: 29,
  business: 99,
};

/**
 * Seuil d'alerte : coût cumulé (USD) au-delà duquel un cours est signalé
 * « anormalement cher » dans le dashboard admin. Éditable.
 */
export const COURSE_COST_ALERT_USD = 2;

// ── Fonctions de calcul ─────────────────────────────────────────────

/** Coût USD d'un appel Claude, à partir des tokens in/out et du modèle. */
export function claudeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = CLAUDE_PRICING_USD_PER_MTOK[model] ?? CLAUDE_PRICING_USD_PER_MTOK[CLAUDE_FALLBACK_MODEL]!;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

/** Coût USD d'une synthèse vocale, à partir du nombre de caractères. */
export function ttsCostUsd(chars: number): number {
  return Math.max(0, chars) * TTS_USD_PER_CHAR;
}

/** Coût USD d'un rendu vidéo, à partir de la durée en secondes. */
export function renderCostUsd(seconds: number): number {
  return Math.max(0, seconds) * RENDER_USD_PER_SECOND;
}

/** Coût USD d'une génération d'image (par défaut : 1 image). */
export function imageCostUsd(units = 1): number {
  return Math.max(0, units) * IMAGE_USD_PER_UNIT;
}

/**
 * Marge d'un plan sur une période : revenu du plan − coût total des cours.
 * `revenueEur` et `costUsd` sont dans deux devises différentes ; le dashboard
 * convertit si besoin. Ici on renvoie les deux + la marge brute en réutilisant
 * un taux EUR→USD éditable pour homogénéiser (défaut 1,08, 2026-07).
 */
export const EUR_TO_USD = 1.08;

export interface PlanMargin {
  plan: string;
  /** Revenu mensuel du plan, en USD (converti depuis EUR). */
  revenueUsd: number;
  /** Coût total des cours de ce plan sur la période, en USD. */
  costUsd: number;
  /** Marge = revenu − coût, en USD. Négative = plan déficitaire. */
  marginUsd: number;
}

/**
 * Calcule la marge d'un plan : (revenu mensuel × nb utilisateurs actifs) − coût.
 * `activeUsers` permet d'agréger le revenu sur la base installée du plan ;
 * passe 1 pour une marge par utilisateur.
 */
export function planMargin(plan: string, costUsd: number, activeUsers = 1): PlanMargin {
  const revenueEur = (PLAN_REVENUE_EUR_PER_MONTH[plan] ?? 0) * Math.max(0, activeUsers);
  const revenueUsd = revenueEur * EUR_TO_USD;
  return {
    plan,
    revenueUsd,
    costUsd,
    marginUsd: revenueUsd - costUsd,
  };
}
