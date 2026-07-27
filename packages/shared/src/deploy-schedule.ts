// Déploiements programmés — « drip » (Prompt 181).
//
// Logique PURE (aucune I/O — testable directement) du planificateur de
// publication ÉTALÉE d'un cours par plateforme. Un plan drip décrit, PAR
// plateforme cible, une CADENCE de publication :
//   - immediate            : tout publier maintenant, en un seul passage ;
//   - N par semaine        : N éléments toutes les semaines, jusqu'à épuisement ;
//   - N par jour pendant M jours : N éléments par jour, M jours au plus.
//
// « Élément » dépend de la plateforme et n'est PAS résolu ici (le worker le
// fait) : un clip vertical pour TikTok/Instagram (ShortClip), le cours entier
// comme unité unique pour les plateformes de cours (Udemy/YouTube/…). Ce module
// ne connaît que des COMPTEURS abstraits (cursor = éléments déjà publiés) et des
// DATES d'échéance — ce qui le rend entièrement déterministe et testable.
//
// L'état runtime d'une entrée (cursor + nextRunAt) est persisté par le modèle
// DeploymentSchedule (packages/db) ; les décisions (combien publier, quand
// re-planifier, quand clôturer) vivent toutes ici, dans planEntryRun.
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Schémas Zod du plan drip                                            */
/* ------------------------------------------------------------------ */

/** Natures de cadence supportées (discriminant du schéma). */
export const DRIP_CADENCE_KINDS = ['immediate', 'per-week', 'per-day'] as const;
export type DripCadenceKind = (typeof DRIP_CADENCE_KINDS)[number];

/** Bornes de sécurité (évitent des plans absurdes / hostiles). */
export const DRIP_LIMITS = {
  /** Max d'éléments par passage (N). */
  MAX_PER_RUN: 1000,
  /** Max de jours d'une cadence « par jour ». */
  MAX_DAYS: 365,
  /** Max d'entrées (plateformes) dans un plan. */
  MAX_ENTRIES: 20,
} as const;

/**
 * Cadence d'une plateforme. Union discriminée sur `kind` :
 *  - immediate : aucun paramètre ;
 *  - per-week  : `count` éléments par semaine ;
 *  - per-day   : `count` éléments par jour, `days` jours au plus.
 */
export const dripCadenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('immediate') }),
  z.object({
    kind: z.literal('per-week'),
    count: z.number().int().min(1).max(DRIP_LIMITS.MAX_PER_RUN),
  }),
  z.object({
    kind: z.literal('per-day'),
    count: z.number().int().min(1).max(DRIP_LIMITS.MAX_PER_RUN),
    days: z.number().int().min(1).max(DRIP_LIMITS.MAX_DAYS),
  }),
]);
export type DripCadence = z.infer<typeof dripCadenceSchema>;

/** Une entrée du plan : une plateforme + sa cadence. */
export const dripEntryInputSchema = z.object({
  platform: z.string().min(1).max(40),
  cadence: dripCadenceSchema,
});
export type DripEntryInput = z.infer<typeof dripEntryInputSchema>;

/**
 * Plan drip complet (corps de la requête de création). `startAt` (ISO) décale le
 * PREMIER passage de toutes les entrées ; absent → maintenant. Les plateformes
 * doivent être uniques (une cadence par plateforme).
 */
export const dripPlanInputSchema = z
  .object({
    entries: z.array(dripEntryInputSchema).min(1).max(DRIP_LIMITS.MAX_ENTRIES),
    startAt: z.string().datetime().optional(),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.entries.forEach((entry, i) => {
      if (seen.has(entry.platform)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Plateforme dupliquée : ${entry.platform}.`,
          path: ['entries', i, 'platform'],
        });
      }
      seen.add(entry.platform);
    });
  });
export type DripPlanInput = z.infer<typeof dripPlanInputSchema>;

/* ------------------------------------------------------------------ */
/* État runtime d'une entrée (miroir du modèle DeploymentSchedule)     */
/* ------------------------------------------------------------------ */

/**
 * État persisté d'une entrée de plan. `cursor` = nombre d'éléments DÉJÀ publiés
 * pour cette plateforme ; `nextRunAt` = prochaine échéance (null = jamais encore
 * planifié → dû au prochain passage).
 */
export interface DripEntryState {
  platform: string;
  cadence: DripCadence;
  cursor: number;
  nextRunAt: Date | null;
}

/* ------------------------------------------------------------------ */
/* Interprétation d'une cadence                                        */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Cadence normalisée : éléments par passage, intervalle, nombre max de passages. */
export interface ParsedCadence {
  /** Éléments publiés par passage. `Infinity` pour `immediate` (= tout d'un coup). */
  perRun: number;
  /** Millisecondes entre deux passages. 0 pour `immediate`. */
  intervalMs: number;
  /** Nombre total de passages, ou `null` si non borné (jusqu'à épuisement). */
  maxRuns: number | null;
}

/**
 * Traduit une cadence en paramètres exploitables (perRun / intervalMs / maxRuns).
 * Pur et total (couvre toutes les variantes de l'union).
 */
export function parseCadence(cadence: DripCadence): ParsedCadence {
  switch (cadence.kind) {
    case 'immediate':
      return { perRun: Number.POSITIVE_INFINITY, intervalMs: 0, maxRuns: 1 };
    case 'per-week':
      return { perRun: cadence.count, intervalMs: WEEK_MS, maxRuns: null };
    case 'per-day':
      return { perRun: cadence.count, intervalMs: DAY_MS, maxRuns: cadence.days };
    default: {
      // Exhaustivité : toute nouvelle variante non gérée est une erreur de compilation.
      const _never: never = cadence;
      return _never;
    }
  }
}

/** Nombre de passages déjà effectués, déduit du cursor (pas de champ dédié). */
function runsDoneOf(cadence: DripCadence, cursor: number): number {
  const { perRun } = parseCadence(cadence);
  if (!Number.isFinite(perRun)) return cursor > 0 ? 1 : 0; // immediate : 1 passage suffit
  return Math.ceil(cursor / perRun);
}

/**
 * L'entrée a-t-elle épuisé son nombre de passages ? (immediate après 1 passage,
 * « par jour » après M passages). Une cadence « par semaine » n'est jamais
 * clôturée par ce critère (maxRuns=null) — seul l'épuisement des éléments la
 * termine, ce que gère le worker via `remaining`. Pur.
 */
export function isCompleted(entry: DripEntryState): boolean {
  const { maxRuns } = parseCadence(entry.cadence);
  if (maxRuns === null) return false;
  return runsDoneOf(entry.cadence, entry.cursor) >= maxRuns;
}

/**
 * Une entrée est-elle TERMINÉE, connaissant son état (cursor déjà avancé) et le
 * nombre d'éléments encore publiables `remaining` ? Terminée si :
 *  - elle a épuisé son nombre de passages (isCompleted), OU
 *  - il ne reste plus rien à publier ET au moins un élément a réellement été
 *    publié (cursor > 0).
 *
 * La condition `cursor > 0` distingue « TOUT publié » de « AUCUN élément encore »
 * (finding 6) : une entrée clip (tiktok/instagram) créée sans aucun ShortClip
 * exploitable a `remaining = 0` dès le départ — sans ce garde-fou elle serait
 * marquée « terminée » (rien à publier == tout publié), alors qu'elle doit
 * rester active/idle jusqu'à ce que des clips existent. Pure.
 */
export function isEntryComplete(entry: DripEntryState, remaining: number): boolean {
  if (isCompleted(entry)) return true;
  return remaining <= 0 && entry.cursor > 0;
}

/**
 * Nombre d'éléments que l'entrée VEUT publier à `now` (0 si pas encore dû ou déjà
 * clôturé). `Infinity` pour une cadence immédiate — l'appelant borne par le
 * nombre d'éléments réellement disponibles. Pur.
 */
export function itemsDue(entry: DripEntryState, now: Date): number {
  if (isCompleted(entry)) return 0;
  const due = entry.nextRunAt === null || entry.nextRunAt.getTime() <= now.getTime();
  if (!due) return 0;
  return parseCadence(entry.cadence).perRun;
}

/**
 * Prochaine échéance après un passage à `now`. Dérivée de l'échéance courante
 * (pas de `now`) pour éviter toute dérive : la cadence reste régulière même si un
 * passage a lieu en léger retard. Base = nextRunAt courant, sinon `now`. Pur.
 */
export function computeNextRunAt(entry: DripEntryState, now: Date): Date {
  const base = entry.nextRunAt?.getTime() ?? now.getTime();
  return new Date(base + parseCadence(entry.cadence).intervalMs);
}

/* ------------------------------------------------------------------ */
/* Décision de passage (cœur pur)                                      */
/* ------------------------------------------------------------------ */

/** Résultat de la planification d'UN passage pour une entrée. */
export interface EntryRunPlan {
  /** Éléments à publier maintenant (0 = rien à faire à ce passage). */
  publishCount: number;
  /** Nouveau cursor après ce passage (cursor + publishCount). */
  nextCursor: number;
  /** Nouvelle échéance à persister. */
  nextRunAt: Date;
  /** L'entrée est-elle terminée (plus aucun travail futur) ? */
  done: boolean;
}

/**
 * Planifie UN passage d'une entrée à `now`, connaissant `remaining` = nombre
 * d'éléments encore non publiés pour cette plateforme (>= 0). Décide combien
 * publier (borné par la cadence ET par les éléments disponibles), le nouveau
 * cursor, la prochaine échéance, et si l'entrée est close (par nombre de passages
 * ou par épuisement des éléments). Pur, déterministe.
 */
export function planEntryRun(entry: DripEntryState, remaining: number, now: Date): EntryRunPlan {
  const safeRemaining = Math.max(0, Math.floor(remaining));
  const want = itemsDue(entry, now);
  const publishCount = Math.max(0, Math.min(want, safeRemaining));
  const nextCursor = entry.cursor + publishCount;

  const advanced: DripEntryState = { ...entry, cursor: nextCursor };
  const remainingAfter = safeRemaining - publishCount;
  // « done » distingue « tout publié » de « aucun élément encore » (finding 6) :
  // une entrée à 0 élément (cursor 0, remaining 0) N'est PAS terminée.
  const done = isEntryComplete(advanced, remainingAfter);

  // On ne re-planifie que si un passage a réellement eu lieu ET que l'entrée
  // n'est pas close ; sinon on conserve l'échéance courante (ou `now` par défaut).
  const shouldReschedule = publishCount > 0 && !done;
  const nextRunAt = shouldReschedule
    ? computeNextRunAt(entry, now)
    : (entry.nextRunAt ?? now);

  return { publishCount, nextCursor, nextRunAt, done };
}

/* ------------------------------------------------------------------ */
/* Construction des entrées persistées à partir d'un plan validé       */
/* ------------------------------------------------------------------ */

/**
 * Transforme un plan validé en entrées persistables (cursor=0, première échéance
 * = `startAt` du plan ou `now`). Pur.
 */
export function buildScheduleEntries(plan: DripPlanInput, now: Date = new Date()): DripEntryState[] {
  const start = plan.startAt ? new Date(plan.startAt) : now;
  return plan.entries.map((entry) => ({
    platform: entry.platform,
    cadence: entry.cadence,
    cursor: 0,
    nextRunAt: start,
  }));
}

/* ------------------------------------------------------------------ */
/* Libellés (calendrier UI / snapshot route)                           */
/* ------------------------------------------------------------------ */

/** Libellé français court d'une cadence (calendrier de publication). */
export function cadenceLabel(cadence: DripCadence): string {
  switch (cadence.kind) {
    case 'immediate':
      return 'Immédiat';
    case 'per-week':
      return `${cadence.count} / semaine`;
    case 'per-day':
      return `${cadence.count} / jour pendant ${cadence.days} j`;
    default: {
      const _never: never = cadence;
      return _never;
    }
  }
}
