// Table de tarifs des providers — source unique et éditable pour l'estimation
// des coûts de génération (Prompt 55). Tous les prix sont documentés et datés ;
// mets-les à jour ici quand un provider change sa grille. Aucune dépendance :
// ce module est importé côté worker (calcul) ET côté web (dashboard marges).

/**
 * Type de coût enregistré (aligné sur CostRecord.kind côté db).
 * 'transcribe' (Whisper) et 'avatar' ajoutés par l'audit coûts 2026-07-26.
 */
export type CostKind = 'claude' | 'tts' | 'render' | 'image' | 'transcribe' | 'avatar';

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
 * Tarifs des LLM CLOUD OpenAI-compatibles (Gemini, DeepSeek, Qwen, Kimi, Grok,
 * GLM, MiniMax, Cloudflare Workers AI), en USD par MILLION de tokens (in/out).
 * Clés = identifiants de MODÈLE réellement facturés (alignés sur le catalogue
 * worker cloud-llm.ts). Les offres à quota gratuit sont à 0 — l'auteur choisit
 * son provider à la création du cours, l'ordre par défaut privilégie le gratuit.
 * Ordres de grandeur des grilles publiques, 2026-07 — éditable.
 */
export const CLOUD_LLM_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Gratuits (quota offert) — coût comptabilisé 0.
  'gemini-flash-latest': { input: 0, output: 0 },
  'gemini-2.5-flash': { input: 0, output: 0 },
  'glm-4.5-flash': { input: 0, output: 0 },
  'glm-4-flash': { input: 0, output: 0 },
  'glm-4.6': { input: 0.6, output: 2.2 },
  // Très bon marché.
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
  'qwen-plus': { input: 0.4, output: 1.2 },
  'qwen-flash': { input: 0.05, output: 0.4 },
  'qwen-turbo': { input: 0.05, output: 0.2 },
  'moonshot-v1-8k': { input: 0.5, output: 2.0 },
  'kimi-k2-0711-preview': { input: 0.6, output: 2.5 },
  'MiniMax-M2': { input: 0.3, output: 1.2 },
  'MiniMax-Text-01': { input: 0.2, output: 1.1 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.3, output: 0.6 },
};

/**
 * Tarif ElevenLabs : facturation au caractère synthétisé.
 * Réf. plan Creator ≈ 22 USD / 100 000 crédits (1 crédit ≈ 1 caractère),
 * soit 0,00022 USD/caractère. 2026-07 — ajuster selon le plan réel.
 */
export const TTS_USD_PER_CHAR = 0.00022;

/**
 * Estimation GPU de la voix premium Chatterbox sur Modal (L4 ≈ 0,80 USD/h,
 * synthèse ~temps réel + un peu). On modélise ~0,04 s de GPU par caractère,
 * soit ≈ 0,0000089 USD/caractère — bien moins que le forfait ElevenLabs, mais
 * non nul (contrairement aux voix locales/Edge). 2026-07 — éditable.
 */
export const TTS_MODAL_USD_PER_CHAR = (0.8 / 3600) * 0.04;

/** Providers TTS GRATUITS (voix neuronales Edge, Piper/Kokoro locaux, silence/mock). */
export const FREE_TTS_PROVIDERS: readonly string[] = ['edge', 'piper', 'kokoro', 'silence', 'mock', 'cache'];

/**
 * Coût USD d'une synthèse vocale selon le PROVIDER réellement utilisé :
 *  - providers gratuits (Edge/Piper/Kokoro/silence) → 0 ;
 *  - Modal GPU : Chatterbox ('modal') ET Qwen3-TTS ('qwen3' — correctif audit
 *    coûts 2026-07-26 : qwen3 était facturé par erreur au tarif ElevenLabs,
 *    ~25× son coût GPU réel) → estimation GPU au caractère ;
 *  - sinon (ElevenLabs/OpenAI) → tarif au caractère ElevenLabs.
 */
export function ttsCostUsdForProvider(provider: string | undefined, chars: number): number {
  const c = Math.max(0, chars);
  if (provider && FREE_TTS_PROVIDERS.includes(provider)) return 0;
  if (provider === 'modal' || provider === 'qwen3') return c * TTS_MODAL_USD_PER_CHAR;
  return c * TTS_USD_PER_CHAR;
}

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

/**
 * Coût USD d'un appel LLM, à partir des tokens in/out et du modèle. Couvre
 * Claude (SDK) ET les modèles cloud OpenAI-compatibles (Gemini/DeepSeek/Qwen…) :
 * un modèle cloud gratuit revient à 0, un modèle inconnu retombe sur la grille
 * Claude par défaut (majore plutôt que sous-estimer).
 */
export function claudeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price =
    CLAUDE_PRICING_USD_PER_MTOK[model] ??
    CLOUD_LLM_PRICING_USD_PER_MTOK[model] ??
    CLAUDE_PRICING_USD_PER_MTOK[CLAUDE_FALLBACK_MODEL]!;
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
 * Transcription Whisper (Modal GPU, audit coûts 2026-07-26) : ~10× temps réel
 * sur L4 (0,80 USD/h) → ~0,000022 USD par seconde d'audio transcrit.
 */
export const TRANSCRIBE_USD_PER_AUDIO_SECOND = (0.8 / 3600) / 10;

/** Coût USD d'une transcription, à partir de la durée audio en secondes. */
export function transcribeCostUsd(audioSeconds: number): number {
  return Math.max(0, audioSeconds) * TRANSCRIBE_USD_PER_AUDIO_SECOND;
}

/**
 * Segment avatar Ditto (Modal GPU A10G ≈ 1,10 USD/h, génération ≈ 4× temps
 * réel, audit coûts 2026-07-26) → ~0,00122 USD par seconde de vidéo produite.
 */
export const AVATAR_USD_PER_VIDEO_SECOND = (1.1 / 3600) * 4;

/** Coût USD d'un segment avatar, à partir de sa durée en secondes. */
export function avatarCostUsd(videoSeconds: number): number {
  return Math.max(0, videoSeconds) * AVATAR_USD_PER_VIDEO_SECOND;
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

// ── Mode « full OSS » (Prompt 160) — comparateur de coût réel par cours ────
//
// En mode OSS (Ollama/Piper-Kokoro/ComfyUI, tout auto-hébergé sur Hetzner),
// il n'y a pas de facturation au token/caractère/image : le seul coût réel
// est le temps de calcul (CPU/GPU) consommé sur la machine Hetzner. On modélise
// donc chaque étape comme une durée de compute (secondes) × un tarif horaire
// éditable, au lieu d'un tarif par unité facturée comme en mode cloud.

/**
 * Choix effectif de provider par famille pour UN cours donné (P160) — stocké
 * sur Course.providerMix (additif, Mixed). 'oss' | 'cloud' par famille,
 * reflète ce qui a RÉELLEMENT été utilisé (pas juste ce que recommande
 * recommendProviderMix — l'auto-sélection peut retomber en cloud si l'OSS
 * était indisponible, ou inversement).
 */
export interface ProviderMix {
  llm: 'oss' | 'cloud';
  tts: 'oss' | 'cloud';
  image: 'oss' | 'cloud';
}

/** Mix par défaut si le cours n'a jamais enregistré de choix explicite. */
export const DEFAULT_PROVIDER_MIX: ProviderMix = { llm: 'oss', tts: 'oss', image: 'oss' };

/**
 * Tarif horaire du compute Hetzner (USD/heure), pour amortir CPU-heures
 * ffmpeg/ollama/piper. Réf. ordre de grandeur d'un serveur dédié Hetzner
 * (ex. CPX52 ~0,10 USD/h en location mensuelle lissée). Éditable — reflète le
 * coût d'infra réel, pas une facturation externe.
 */
export const HETZNER_USD_PER_HOUR = 0.1;
const HETZNER_USD_PER_SECOND = HETZNER_USD_PER_HOUR / 3600;

/**
 * Durées de compute estimées par étape OSS, en secondes de calcul MACHINE
 * (pas secondes de contenu produit) — sert de facteur multiplicatif appliqué
 * à la quantité produite (tokens/caractères/secondes de vidéo/images).
 * Éditable : ajuster selon le matériel Hetzner réel (CPU vs GPU).
 */
export const OSS_COMPUTE_SECONDS_PER_UNIT = {
  /** Ollama (CPU) : ~1000 tokens générés ≈ 20 s de calcul (llama3.2:8b, repli léger). */
  llmSecondsPer1000Tokens: 20,
  /** Piper/Kokoro (CPU) : synthèse quasi temps réel, ~0,15 s de calcul par caractère. */
  ttsSecondsPerChar: 0.15,
  /** ComfyUI (GPU/CPU) : génération d'une image, forfait par image. */
  imageSecondsPerUnit: 8,
} as const;

/** Coût OSS (USD) d'une génération LLM Ollama, à partir des tokens produits (in+out). */
export function ossLlmCostUsd(tokensIn: number, tokensOut: number): number {
  const totalTokens = Math.max(0, tokensIn) + Math.max(0, tokensOut);
  const seconds = (totalTokens / 1000) * OSS_COMPUTE_SECONDS_PER_UNIT.llmSecondsPer1000Tokens;
  return seconds * HETZNER_USD_PER_SECOND;
}

/** Coût OSS (USD) d'une synthèse vocale Piper/Kokoro, à partir des caractères. */
export function ossTtsCostUsd(chars: number): number {
  const seconds = Math.max(0, chars) * OSS_COMPUTE_SECONDS_PER_UNIT.ttsSecondsPerChar;
  return seconds * HETZNER_USD_PER_SECOND;
}

/** Coût OSS (USD) d'un rendu vidéo ffmpeg — même compute que le mode cloud (local dans les deux cas). */
export function ossRenderCostUsd(seconds: number): number {
  return renderCostUsd(seconds);
}

/** Coût OSS (USD) d'une génération d'image ComfyUI (par défaut : 1 image). */
export function ossImageCostUsd(units = 1): number {
  const seconds = Math.max(0, units) * OSS_COMPUTE_SECONDS_PER_UNIT.imageSecondsPerUnit;
  return seconds * HETZNER_USD_PER_SECOND;
}

/** Locales considérées comme rares (hors fr/en) — recommandation cloud pour la qualité de traduction/voix. */
export const RARE_LOCALES: readonly string[] = ['ar'];

/** Contexte minimal nécessaire pour recommander un mix de providers pour un cours. */
export interface RecommendMixContext {
  /** Locale du cours (fr/en/ar…). */
  locale: string;
  /** Plan de l'utilisateur — 'business' déclenche l'exigence qualité premium. */
  plan: string;
}

/**
 * Recommande le mix de providers optimal pour un cours (règle simple, P160) :
 *   - langue rare (hors fr/en) OU plan business (qualité premium attendue)
 *     → cloud pour le plan/scripts (llm) — la qualité de rédaction/traduction
 *       prime ; reste OSS pour tts/image (pas d'impact qualité perçu aussi fort).
 *   - sinon → full OSS (llm/tts/image), le moins cher.
 * Recommandation, PAS une contrainte : le mix réellement utilisé (Course.providerMix)
 * peut différer (retombée mock-friendly, PROVIDER_MODE forcé, absence de clé cloud…).
 */
export function recommendProviderMix(ctx: RecommendMixContext): ProviderMix {
  const isRareLocale = RARE_LOCALES.includes(ctx.locale);
  const isPremiumPlan = ctx.plan === 'business';
  if (isRareLocale || isPremiumPlan) {
    return { llm: 'cloud', tts: 'oss', image: 'oss' };
  }
  return { ...DEFAULT_PROVIDER_MIX };
}

/** Détail du coût OSS d'un cours — même forme que CourseCost côté cloud pour affichage côte à côte. */
export interface OssCourseCost {
  llmUsd: number;
  ttsUsd: number;
  renderUsd: number;
  imageUsd: number;
  totalUsd: number;
}

/**
 * Estime le coût "full OSS" d'un cours à partir des MÊMES métriques brutes que
 * le mode cloud (tokens/chars/seconds/images) — permet le comparateur côte à
 * côte "ce cours : X€ en mode cloud vs Y€ en mode OSS" sans double instrumentation.
 */
export function computeOssCost(usage: {
  tokensIn?: number;
  tokensOut?: number;
  chars?: number;
  renderSeconds?: number;
  images?: number;
}): OssCourseCost {
  const llmUsd = ossLlmCostUsd(usage.tokensIn ?? 0, usage.tokensOut ?? 0);
  const ttsUsd = ossTtsCostUsd(usage.chars ?? 0);
  const renderUsd = ossRenderCostUsd(usage.renderSeconds ?? 0);
  const imageUsd = ossImageCostUsd(usage.images ?? 0);
  return {
    llmUsd,
    ttsUsd,
    renderUsd,
    imageUsd,
    totalUsd: llmUsd + ttsUsd + renderUsd + imageUsd,
  };
}

// ── Coût par méthode de paiement (Prompt 158) ──────────────────────────────
//
// CMI reste la référence Maroc (P54, aucun changement nécessaire) ; Paddle
// couvre l'international (Merchant of Record, commission incluse) ; le
// virement manuel (Prompt 158) est l'option zéro commission pour
// l'international, au prix d'une validation humaine (pas de webhook).

/** Méthodes de paiement connues, alignées sur PaymentProvider (db) hors mock/lemonsqueezy. */
export const PAYMENT_METHODS = ['cmi', 'paddle', 'manual'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentMethodFee {
  /** Part proportionnelle du montant prélevée par le prestataire (0.05 = 5%). */
  feePercent: number;
  /** Frais fixe par transaction, en USD (0 si aucun). */
  feeFixedUsd: number;
  /** Repère lisible de la grille de référence (pour audit humain). */
  note: string;
}

/**
 * Grille de frais par méthode :
 *  - CMI (Maroc) : commission interbancaire ~2,5% du montant, pas de frais
 *    fixe (grille négociée par établissement — ordre de grandeur documenté).
 *  - Paddle (international, Merchant of Record) : ~5% + 0,50 USD/transaction
 *    (grille publique Paddle Billing, 2026-07).
 *  - Virement manuel (Prompt 158) : zéro commission prestataire — coût
 *    opérationnel (temps admin de validation) non modélisé ici.
 */
export const PAYMENT_METHOD_FEES: Record<PaymentMethod, PaymentMethodFee> = {
  cmi: {
    feePercent: 0.025,
    feeFixedUsd: 0,
    note: 'CMI Maroc — commission interbancaire ~2,5% (ordre de grandeur, 2026-07)',
  },
  paddle: {
    feePercent: 0.05,
    feeFixedUsd: 0.5,
    note: 'Paddle Billing — 5% + 0,50 USD/transaction (grille publique, 2026-07)',
  },
  manual: {
    feePercent: 0,
    feeFixedUsd: 0,
    note: 'Virement manuel — zéro commission prestataire (validation admin, Prompt 158)',
  },
};

/**
 * Coût (frais prestataire) d'un paiement selon la méthode, dans la même unité
 * que `amountMinor` fourni (ex. centimes en entrée ⇒ centimes en sortie).
 * Le frais fixe (`feeFixedUsd`, exprimé en USD) n'est ajouté QUE si l'appelant
 * confirme que le montant est déjà en USD (`currencyIsUsd`) — sinon il est
 * ignoré pour ne pas mélanger les devises sans taux de change explicite.
 */
export function paymentMethodCost(
  method: PaymentMethod,
  amountMinor: number,
  opts: { currencyIsUsd?: boolean } = {},
): number {
  const fee = PAYMENT_METHOD_FEES[method];
  const proportional = Math.max(0, amountMinor) * fee.feePercent;
  const fixed = opts.currencyIsUsd ? fee.feeFixedUsd * 100 : 0; // feeFixedUsd (USD) → centimes
  return proportional + fixed;
}
