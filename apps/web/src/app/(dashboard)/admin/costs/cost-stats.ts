import {
  avatarCostUsd,
  claudeCostUsd,
  ttsCostUsdForProvider,
  renderCostUsd,
  imageCostUsd,
  transcribeCostUsd,
  planMargin,
  COURSE_COST_ALERT_USD,
  computeOssCost,
  recommendProviderMix,
  DEFAULT_PROVIDER_MIX,
  type CostKind,
  type PlanMargin,
  type ProviderMix,
  type OssCourseCost,
} from '@sallycourse/shared';

/**
 * Fonctions PURES d'agrégation des coûts de génération (P55).
 *
 * Elles prennent des lignes CostRecord brutes (déjà projetées depuis Mongo) et
 * en dérivent : le coût par cours, la marge par plan (revenu − coût), et les
 * cours dépassant le seuil d'alerte. Isolées de Mongoose pour être testables
 * sans base — la page serveur fait les requêtes puis passe les tableaux ici.
 *
 * Les montants sont ré-estimés ici depuis la table de tarifs partagée : la
 * source de vérité reste pricing-table, et un changement de grille se reflète
 * sans migration de données (les métriques brutes tokens/chars/seconds sont
 * conservées sur chaque CostRecord).
 */

/** Ligne CostRecord projetée pour l'agrégation (métriques brutes + contexte). */
export interface CostRow {
  courseId: string;
  userId: string;
  kind: CostKind;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  chars?: number | undefined;
  seconds?: number | undefined;
  model?: string | undefined;
  /** Horodatage de l'appel (pour l'historique/graphes temporels). */
  createdAt?: Date | string | undefined;
}

/** Coût USD d'une ligne, ré-estimé depuis la table de tarifs (provider-aware). */
export function rowCostUsd(row: CostRow): number {
  switch (row.kind) {
    case 'claude':
      // model porte l'id de modèle réel (Claude OU cloud : gemini/deepseek/…) ;
      // la grille connaît les deux familles, un modèle gratuit revient à 0.
      return claudeCostUsd(row.model ?? 'claude-sonnet-5', row.tokensIn ?? 0, row.tokensOut ?? 0);
    case 'tts':
      // model porte le provider TTS réel (modal/edge/piper/elevenlabs…) ⇒ coût
      // exact : voix locales/Edge gratuites (0), Modal GPU, ElevenLabs au caractère.
      return ttsCostUsdForProvider(row.model, row.chars ?? 0);
    case 'render':
      return renderCostUsd(row.seconds ?? 0);
    case 'image':
      return imageCostUsd(1);
    // Whisper et avatar (audit coûts 2026-07-26) : facturés à la seconde.
    case 'transcribe':
      return transcribeCostUsd(row.seconds ?? 0);
    case 'avatar':
      return avatarCostUsd(row.seconds ?? 0);
    default:
      return 0;
  }
}

/** Ventilation d'un coût par nature (pour l'affichage détaillé). */
export type CostByKind = Record<CostKind, number>;

function emptyByKind(): CostByKind {
  return { claude: 0, tts: 0, render: 0, image: 0, transcribe: 0, avatar: 0 };
}

/** Total agrégé d'un cours : coût global + ventilation par nature. */
export interface CourseCost {
  courseId: string;
  userId: string;
  totalUsd: number;
  byKind: CostByKind;
  /** Vrai si totalUsd dépasse le seuil d'alerte. */
  overThreshold: boolean;
}

/**
 * Agrège les lignes par cours. Retourne un tableau trié par coût décroissant
 * (les cours les plus chers d'abord) — pratique pour repérer les anomalies.
 */
export function costByCourse(
  rows: readonly CostRow[],
  alertThresholdUsd: number = COURSE_COST_ALERT_USD,
): CourseCost[] {
  const map = new Map<string, CourseCost>();
  for (const row of rows) {
    const usd = rowCostUsd(row);
    let entry = map.get(row.courseId);
    if (!entry) {
      entry = {
        courseId: row.courseId,
        userId: row.userId,
        totalUsd: 0,
        byKind: emptyByKind(),
        overThreshold: false,
      };
      map.set(row.courseId, entry);
    }
    entry.totalUsd += usd;
    entry.byKind[row.kind] += usd;
  }
  const list = [...map.values()];
  for (const c of list) {
    c.totalUsd = round(c.totalUsd);
    for (const k of Object.keys(c.byKind) as CostKind[]) c.byKind[k] = round(c.byKind[k]);
    c.overThreshold = c.totalUsd > alertThresholdUsd;
  }
  return list.sort((a, b) => b.totalUsd - a.totalUsd);
}

/** Coût total (USD) de toutes les lignes. */
export function totalCostUsd(rows: readonly CostRow[]): number {
  return round(rows.reduce((acc, r) => acc + rowCostUsd(r), 0));
}

/**
 * Marge par plan : revenu du plan (× nb d'utilisateurs actifs) − coût total des
 * cours de ce plan. `costByPlan` mappe planId → coût USD ; `activeUsersByPlan`
 * mappe planId → nb d'utilisateurs (pour agréger le revenu sur la base
 * installée). Un plan sans coût ni utilisateur est ignoré.
 */
export function marginByPlan(
  costByPlan: Record<string, number>,
  activeUsersByPlan: Record<string, number>,
): PlanMargin[] {
  const plans = new Set<string>([...Object.keys(costByPlan), ...Object.keys(activeUsersByPlan)]);
  const out: PlanMargin[] = [];
  for (const plan of plans) {
    const cost = round(costByPlan[plan] ?? 0);
    const users = activeUsersByPlan[plan] ?? 0;
    const m = planMargin(plan, cost, users);
    out.push({
      plan: m.plan,
      revenueUsd: round(m.revenueUsd),
      costUsd: round(m.costUsd),
      marginUsd: round(m.marginUsd),
    });
  }
  // Marge décroissante : les plans les plus rentables d'abord.
  return out.sort((a, b) => b.marginUsd - a.marginUsd);
}

/** Cours dépassant le seuil d'alerte (sous-ensemble de costByCourse). */
export function alertingCourses(
  courseCosts: readonly CourseCost[],
): CourseCost[] {
  return courseCosts.filter((c) => c.overThreshold);
}

// ── Comparateur cloud vs OSS (Prompt 160) ───────────────────────────────

/** Usage brut agrégé d'un cours — mêmes métriques que CostRow, sommées par nature. */
export interface CourseUsage {
  tokensIn: number;
  tokensOut: number;
  chars: number;
  renderSeconds: number;
  images: number;
}

function emptyUsage(): CourseUsage {
  return { tokensIn: 0, tokensOut: 0, chars: 0, renderSeconds: 0, images: 0 };
}

/**
 * Agrège les métriques brutes (tokens/chars/seconds/nb images) par cours —
 * base commune pour ré-estimer le coût en mode cloud (déjà fait par
 * costByCourse/rowCostUsd) ET en mode OSS (computeOssCost), sans double
 * instrumentation : les CostRecord existants (P55) suffisent aux deux calculs.
 */
export function usageByCourse(rows: readonly CostRow[]): Map<string, CourseUsage> {
  const map = new Map<string, CourseUsage>();
  for (const row of rows) {
    let u = map.get(row.courseId);
    if (!u) {
      u = emptyUsage();
      map.set(row.courseId, u);
    }
    switch (row.kind) {
      case 'claude':
        u.tokensIn += row.tokensIn ?? 0;
        u.tokensOut += row.tokensOut ?? 0;
        break;
      case 'tts':
        u.chars += row.chars ?? 0;
        break;
      case 'render':
        u.renderSeconds += row.seconds ?? 0;
        break;
      case 'image':
        u.images += 1;
        break;
      default:
        break;
    }
  }
  return map;
}

/** Comparaison cloud vs OSS pour un cours, + mix recommandé et mix réellement utilisé. */
export interface CourseCostComparison {
  courseId: string;
  cloudTotalUsd: number;
  ossTotalUsd: number;
  ossBreakdown: OssCourseCost;
  /** Recommandation automatique (règle simple : langue rare/plan business → llm cloud, sinon full OSS). */
  recommendedMix: ProviderMix;
  /** Mix effectivement utilisé pour générer ce cours (Course.providerMix) — défaut OSS si jamais enregistré. */
  actualMix: ProviderMix;
}

/**
 * Construit le comparateur "ce cours : X€ cloud vs Y€ OSS" pour un cours donné.
 * `usage` = métriques brutes agrégées (usageByCourse) ; `cloudTotalUsd` = le
 * total déjà calculé par costByCourse (ré-estimation identique, pas de calcul
 * dupliqué) ; `locale`/`plan` alimentent la recommandation ; `actualMix` vient
 * de Course.providerMix (undefined → mix par défaut OSS, cours antérieurs au P160).
 */
export function compareCourseCost(params: {
  courseId: string;
  cloudTotalUsd: number;
  usage: CourseUsage;
  locale: string;
  plan: string;
  actualMix?: ProviderMix | null;
}): CourseCostComparison {
  const ossBreakdown = computeOssCost(params.usage);
  return {
    courseId: params.courseId,
    cloudTotalUsd: round(params.cloudTotalUsd),
    ossTotalUsd: round(ossBreakdown.totalUsd),
    ossBreakdown: {
      llmUsd: round(ossBreakdown.llmUsd),
      ttsUsd: round(ossBreakdown.ttsUsd),
      renderUsd: round(ossBreakdown.renderUsd),
      imageUsd: round(ossBreakdown.imageUsd),
      totalUsd: round(ossBreakdown.totalUsd),
    },
    recommendedMix: recommendProviderMix({ locale: params.locale, plan: params.plan }),
    actualMix: params.actualMix ?? DEFAULT_PROVIDER_MIX,
  };
}

// ── Ventilation par PROVIDER + historique temporel (dashboard usage) ──────────

/**
 * Étiquette de provider dérivée d'une ligne. Pour la génération de texte
 * (kind=claude), le provider EST le modèle facturé (gemini-flash-latest,
 * claude-sonnet-5, deepseek-chat…). Pour la voix, c'est le moteur TTS
 * (modal/edge/piper/elevenlabs…). Rendu/images ont un provider fixe.
 */
export function providerOfRow(row: CostRow): string {
  switch (row.kind) {
    case 'claude':
      return row.model ?? 'inconnu';
    case 'tts':
      return row.model ?? 'tts';
    case 'render':
      return row.model ?? 'ffmpeg';
    case 'image':
      // model porte le moteur réel depuis l'audit coûts 2026-07-26 (sdxl/zimage).
      return row.model ?? 'image';
    case 'transcribe':
      return row.model ?? 'whisper';
    case 'avatar':
      return row.model ?? 'avatar';
    default:
      return 'inconnu';
  }
}

/** Usage agrégé d'un provider : nombre d'appels, coût, et métriques brutes. */
export interface ProviderUsage {
  provider: string;
  kind: CostKind;
  calls: number;
  totalUsd: number;
  tokensIn: number;
  tokensOut: number;
  chars: number;
  seconds: number;
}

/**
 * Agrège l'usage par provider (clé = provider + nature). Trié par coût
 * décroissant puis nombre d'appels — les providers les plus sollicités d'abord.
 * Un appel = une ligne CostRecord (chaque tentative LLM/segment TTS compte).
 */
export function costByProvider(rows: readonly CostRow[]): ProviderUsage[] {
  const map = new Map<string, ProviderUsage>();
  for (const row of rows) {
    const provider = providerOfRow(row);
    const key = `${row.kind}::${provider}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { provider, kind: row.kind, calls: 0, totalUsd: 0, tokensIn: 0, tokensOut: 0, chars: 0, seconds: 0 };
      map.set(key, entry);
    }
    entry.calls += 1;
    entry.totalUsd += rowCostUsd(row);
    entry.tokensIn += row.tokensIn ?? 0;
    entry.tokensOut += row.tokensOut ?? 0;
    entry.chars += row.chars ?? 0;
    entry.seconds += row.seconds ?? 0;
  }
  const list = [...map.values()];
  for (const e of list) e.totalUsd = round(e.totalUsd);
  return list.sort((a, b) => b.totalUsd - a.totalUsd || b.calls - a.calls);
}

/** Point d'historique journalier : date (YYYY-MM-DD) + coût + appels ventilés. */
export interface UsageDay {
  date: string;
  totalUsd: number;
  calls: number;
  byKind: CostByKind;
}

/** Convertit un createdAt (Date|string) en clé de jour UTC 'YYYY-MM-DD'. */
function dayKey(value: Date | string | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Historique journalier des `days` derniers jours (aujourd'hui inclus, UTC),
 * chaque jour présent même sans activité (série continue pour le graphe).
 * `today` (YYYY-MM-DD) est injecté par l'appelant — les fonctions restent pures
 * et testables sans horloge.
 */
export function usageTimeline(rows: readonly CostRow[], today: string, days = 30): UsageDay[] {
  // Squelette de jours (du plus ancien au plus récent).
  const skeleton: UsageDay[] = [];
  const index = new Map<string, UsageDay>();
  const base = new Date(`${today}T00:00:00.000Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const day: UsageDay = { date: key, totalUsd: 0, calls: 0, byKind: emptyByKind() };
    skeleton.push(day);
    index.set(key, day);
  }
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    if (!key) continue;
    const day = index.get(key);
    if (!day) continue; // hors fenêtre
    const usd = rowCostUsd(row);
    day.totalUsd += usd;
    day.calls += 1;
    day.byKind[row.kind] += usd;
  }
  for (const day of skeleton) {
    day.totalUsd = round(day.totalUsd);
    for (const k of Object.keys(day.byKind) as CostKind[]) day.byKind[k] = round(day.byKind[k]);
  }
  return skeleton;
}

/** Arrondi USD à 4 décimales (les micro-coûts token restent lisibles). */
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
