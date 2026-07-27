import { z } from 'zod';

/**
 * Parcours d'apprentissage / bundles (Prompt 199) : logique PURE (aucune I/O).
 *
 * Un parcours est une liste ORDONNÉE de cours DÉJÀ publiés sur le LMS interne.
 * Il ne crée AUCUN second système de progression : la progression du parcours
 * se DÉRIVE des Enrollment existants (leur `completedAt`), et le certificat de
 * parcours réutilise le gabarit `certificate` (certLabel/descriptionLine).
 *
 * Ce module porte : le schéma de la page de vente générée, le calcul de
 * progression globale, la résolution des verrous de prérequis et le calcul de
 * l'économie réalisée par le prix bundle.
 */

/** Nombre maximum de cours chaînables dans un parcours (borne de saisie). */
export const LEARNING_PATH_MAX_COURSES = 20;

/* ------------------------------------------------------------------ */
/* Page de vente générée (LLM)                                         */
/* ------------------------------------------------------------------ */

/**
 * Page de vente d'un parcours produite par le LLM (ou la fixture mock) puis
 * persistée telle quelle sur LearningPath.salesPage. Bornes volontairement
 * strictes : une sortie hors bornes est rejetée plutôt qu'affichée dégradée.
 */
export const learningPathSalesPageSchema = z.object({
  headline: z.string().min(1).max(160),
  subheadline: z.string().min(1).max(320),
  /** Bénéfices concrets promis à l'issue du parcours complet. */
  outcomes: z.array(z.string().min(1).max(200)).min(3).max(8),
  /** Profils à qui s'adresse le parcours. */
  audience: z.array(z.string().min(1).max(200)).min(2).max(6),
  /** Un paragraphe par cours du parcours, dans l'ordre (« pourquoi cette étape »). */
  courseTeasers: z
    .array(
      z.object({
        /**
         * Cours ciblé — rattaché par le générateur APRÈS la sortie du LLM (qui
         * ne le connaît pas). Permet à la page publique d'apparier chaque pitch
         * par IDENTITÉ et non par position : réordonner ou retirer un cours du
         * parcours ne désaligne donc plus les pitchs. Optionnel : rétro-compat
         * des pages de vente générées avant ce rattachement.
         */
        courseId: z.string().optional(),
        courseTitle: z.string().min(1).max(200),
        pitch: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(LEARNING_PATH_MAX_COURSES),
  faq: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        answer: z.string().min(1).max(600),
      }),
    )
    .min(2)
    .max(6),
  ctaLabel: z.string().min(1).max(60),
});

export type LearningPathSalesPage = z.infer<typeof learningPathSalesPageSchema>;

/* ------------------------------------------------------------------ */
/* Progression du parcours (dérivée des Enrollment)                    */
/* ------------------------------------------------------------------ */

/** Un cours du parcours : identifiant, rang et verrou de prérequis. */
export interface PathCourseRef {
  courseId: string;
  order: number;
  /** true → le cours reste verrouillé tant que le PRÉCÉDENT n'est pas terminé. */
  requiresPrevious: boolean;
}

/**
 * Inscription à un cours, telle que portée par Enrollment (P43) : seule
 * `completedAt` compte pour le parcours — aucune donnée de progression n'est
 * dupliquée.
 */
export interface CourseEnrollmentLike {
  courseId: string;
  completedAt?: Date | string | null;
}

export interface PathProgress {
  completedCourses: number;
  totalCourses: number;
  /** 0–100, arrondi. Parcours vide → 0. */
  percent: number;
  /** true seulement si le parcours a au moins un cours et qu'ils sont TOUS terminés. */
  completed: boolean;
}

/** Ids (string) des cours effectivement terminés parmi les inscriptions fournies. */
export function completedCourseIds(enrollments: readonly CourseEnrollmentLike[]): Set<string> {
  const ids = new Set<string>();
  for (const enrollment of enrollments) {
    if (enrollment.completedAt) ids.add(String(enrollment.courseId));
  }
  return ids;
}

/**
 * Progression globale du parcours, DÉRIVÉE des Enrollment existants : un cours
 * compte comme terminé si l'apprenant a une inscription dont `completedAt` est
 * renseignée. Les inscriptions à des cours hors du parcours sont ignorées, et
 * un cours listé deux fois n'est compté qu'une fois.
 */
export function computePathProgress(
  courses: readonly PathCourseRef[],
  enrollments: readonly CourseEnrollmentLike[],
): PathProgress {
  const done = completedCourseIds(enrollments);
  const uniqueCourseIds = new Set(courses.map((course) => String(course.courseId)));
  const totalCourses = uniqueCourseIds.size;

  if (totalCourses === 0) {
    return { completedCourses: 0, totalCourses: 0, percent: 0, completed: false };
  }

  let completedCourses = 0;
  for (const courseId of uniqueCourseIds) {
    if (done.has(courseId)) completedCourses += 1;
  }

  const percent = Math.max(0, Math.min(100, Math.round((completedCourses / totalCourses) * 100)));
  return { completedCourses, totalCourses, percent, completed: completedCourses >= totalCourses };
}

/* ------------------------------------------------------------------ */
/* Prérequis : verrouillage en chaîne                                  */
/* ------------------------------------------------------------------ */

export interface ResolvedPathCourse extends PathCourseRef {
  /** false → le cours précédent (dans l'ordre) n'est pas terminé. */
  unlocked: boolean;
  /** Terminé par l'apprenant (Enrollment.completedAt renseignée). */
  completed: boolean;
}

/**
 * Résout les verrous de prérequis dans l'ORDRE du parcours. Un cours marqué
 * `requiresPrevious` n'est déverrouillé que si le cours qui le précède est à la
 * fois DÉVERROUILLÉ et TERMINÉ — le verrouillage est donc TRANSITIF : dès qu'un
 * maillon requis de la chaîne n'est pas terminé, tous les suivants restent
 * verrouillés, même si le prédécesseur immédiat est complété (ex. cours acheté
 * séparément hors parcours). Le premier cours n'a pas de précédent : toujours
 * déverrouillé.
 *
 * Note : un cours peut être `completed:true` tout en étant `unlocked:false` —
 * l'apprenant l'a terminé hors du parcours alors qu'une étape antérieure de la
 * chaîne manque. Ce verrouillage est un GUIDE pédagogique d'affichage ; l'accès
 * réel au contenu reste régi par l'Enrollment du cours (le bundle est payé).
 */
export function resolveUnlockedCourses(
  courses: readonly PathCourseRef[],
  completedIds: ReadonlySet<string> | readonly string[],
): ResolvedPathCourse[] {
  const done = completedIds instanceof Set ? completedIds : new Set(completedIds as readonly string[]);
  const ordered = [...courses].sort((a, b) => a.order - b.order);

  const resolved: ResolvedPathCourse[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const course = ordered[index]!;
    const previous = index > 0 ? resolved[index - 1] : undefined;
    const unlocked =
      !course.requiresPrevious || !previous || (previous.unlocked && previous.completed);
    resolved.push({
      ...course,
      unlocked,
      completed: done.has(String(course.courseId)),
    });
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Prix bundle                                                         */
/* ------------------------------------------------------------------ */

export interface BundleSavings {
  /** Somme des prix des cours pris séparément (centimes). */
  coursesTotalCents: number;
  bundlePriceCents: number;
  /** Économie réalisée (centimes) — jamais négative (bundle plus cher → 0). */
  savingsCents: number;
  /** Économie en % du total des cours (0 si les cours sont tous gratuits). */
  savingsPercent: number;
}

/**
 * Économie du prix bundle face à l'achat des cours un par un. Bornes : les
 * prix négatifs ou non finis sont ignorés (0), et un bundle plus cher que la
 * somme des cours ne produit jamais une « économie » négative.
 */
export function bundleSavings(
  coursePrices: readonly number[],
  bundlePriceCents: number,
): BundleSavings {
  const sanitize = (value: number): number =>
    Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

  const coursesTotalCents = coursePrices.reduce<number>((sum, price) => sum + sanitize(price), 0);
  const bundle = sanitize(bundlePriceCents);
  const savingsCents = Math.max(0, coursesTotalCents - bundle);
  const savingsPercent =
    coursesTotalCents > 0 ? Math.round((savingsCents / coursesTotalCents) * 100) : 0;

  return { coursesTotalCents, bundlePriceCents: bundle, savingsCents, savingsPercent };
}

/* ------------------------------------------------------------------ */
/* Slug                                                                */
/* ------------------------------------------------------------------ */

/**
 * Slug d'URL déterministe dérivé du titre du parcours (page de vente publique
 * /paths/[slug]). Accents retirés, non-alphanumériques → tirets, bornes
 * nettoyées. Un titre sans caractère exploitable (ex. « ??? ») renvoie ''
 * — l'appelant complète alors avec un suffixe unique.
 */
export function slugifyPathTitle(title: string): string {
  return title
    .normalize('NFD')
    // Diacritiques combinants (U+0300–U+036F) issus de la normalisation NFD.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
