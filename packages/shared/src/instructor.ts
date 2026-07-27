import { z } from 'zod';

/**
 * Page instructeur publique (Prompt 205) — logique PURE (aucune I/O).
 *
 * Un instructeur peut réserver un « handle » (@nom) qui lui ouvre une page
 * portfolio publique : bio générée par LLM, catalogue de ses cours PUBLIÉS
 * (LmsListing.published), liens vers les plateformes où le cours est réellement
 * déployé (Deployment.status='published'), statistiques agrégées et avis RÉELS
 * du LMS interne (CourseReview).
 *
 * Ce module porte : le format/la réservation du handle, la suggestion depuis le
 * nom, le schéma de la bio, les agrégats (stats + avis) et le JSON-LD
 * schema.org. Les I/O (Mongo, LLM) restent dans les routes et lib/ du web.
 */

/* ------------------------------------------------------------------ */
/* Handle                                                              */
/* ------------------------------------------------------------------ */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/** Handle STOCKÉ (sans le « @ ») : minuscules, chiffres, tiret, underscore. */
export const HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;

/** Segment d'URL de la page publique : « @handle » (le « @ » fait partie du chemin). */
export const HANDLE_URL_PATTERN = /^@[a-z0-9_-]{3,30}$/;

/**
 * Handles interdits : segments racine EXISTANTS de l'App Router (et leurs
 * variantes évidentes) + mots réservés à l'infrastructure. Même si l'URL
 * publique est préfixée par « @ » (donc sans collision réelle possible avec
 * /blog ou /pricing), on refuse ces handles pour éviter toute ambiguïté de
 * lecture et garder la liberté d'ouvrir un jour /handle sans « @ ».
 */
export const RESERVED_HANDLES: readonly string[] = [
  // Segments racine réels de apps/web/src/app
  'admin',
  'api',
  'blog',
  'dashboard',
  'demo',
  'design',
  'learn',
  'legal',
  'login',
  'marketplace',
  'paths',
  'pricing',
  'promo',
  'register',
  'school',
  'showcase',
  'verify',
  // Chemins usuels / infrastructure
  'about',
  'account',
  'assets',
  'auth',
  'billing',
  'cgu',
  'cgv',
  'contact',
  'course',
  'courses',
  'favicon',
  'help',
  'home',
  'index',
  'instructor',
  'instructeur',
  'new',
  'null',
  'privacy',
  'public',
  'robots',
  'root',
  'sallycourse',
  'settings',
  'sitemap',
  'static',
  'support',
  'undefined',
  'www',
];

const RESERVED_SET = new Set(RESERVED_HANDLES);

export type HandleError = 'format' | 'reserved';

export type HandleValidation = { valid: true } | { valid: false; error: HandleError };

/** Handle valide ? (format + non réservé). PURE. */
export function validateHandle(handle: string): HandleValidation {
  const value = handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(value)) return { valid: false, error: 'format' };
  if (RESERVED_SET.has(value)) return { valid: false, error: 'reserved' };
  return { valid: true };
}

/** Handle réservé par la plateforme ? PURE. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_SET.has(handle.trim().toLowerCase());
}

/**
 * Segment d'URL (« @jean-dupont ») → handle stocké (« jean-dupont »), ou null
 * si le segment ne respecte pas le format ou vise un handle réservé. Utilisé
 * par la page publique : tout ce qui n'est pas un handle valide est un 404.
 * PURE.
 */
export function parseHandleParam(segment: string): string | null {
  const decoded = segment.trim().toLowerCase();
  if (!HANDLE_URL_PATTERN.test(decoded)) return null;
  const handle = decoded.slice(1);
  return validateHandle(handle).valid ? handle : null;
}

/** Chemin public d'un handle (toujours préfixé « @ »). PURE. */
export function instructorPath(handle: string): string {
  return `/@${handle}`;
}

const ACCENT_MAP: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', ö: 'o', õ: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  æ: 'ae', œ: 'oe', ß: 'ss',
};

/**
 * Propose un handle depuis le nom affiché : translittération ASCII, minuscules,
 * séparateurs → tiret, troncature à 30 caractères. Si le résultat est trop
 * court, réservé, ou vide (nom entièrement non latin, ex. arabe), on retombe
 * sur un handle dérivé du `fallbackSeed` (ex. id utilisateur) — DÉTERMINISTE :
 * la même entrée donne toujours la même proposition. PURE.
 */
export function suggestHandle(name: string, fallbackSeed = ''): string {
  const ascii = [...name.toLowerCase()]
    .map((char) => ACCENT_MAP[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/-+$/g, '');

  const seed = fallbackSeed.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (ascii.length >= HANDLE_MIN_LENGTH && !RESERVED_SET.has(ascii)) return ascii;

  // Base trop courte / réservée : on la complète avec la graine (jamais aléatoire).
  const suffix = (seed || 'sally').slice(-6);
  const base = ascii.length > 0 ? ascii : 'instructeur';
  return `${base}-${suffix}`.slice(0, HANDLE_MAX_LENGTH).replace(/-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* Bio générée (LLM)                                                   */
/* ------------------------------------------------------------------ */

/** Bio d'instructeur telle que produite par le LLM et persistée sur User. */
export const instructorBioSchema = z.object({
  /** Accroche d'une ligne affichée sous le nom (ex. « Ingénieur QA, 12 ans de terrain »). */
  headline: z.string().trim().min(1).max(120),
  /** Biographie rédigée à la 3e personne, 2–3 paragraphes courts. */
  bio: z.string().trim().min(60).max(1200),
  /** Domaines d'expertise déduits du catalogue (affichés en badges). */
  expertise: z.array(z.string().trim().min(1).max(40)).min(2).max(8),
});

export type InstructorBio = z.infer<typeof instructorBioSchema>;

/* ------------------------------------------------------------------ */
/* Statistiques agrégées du catalogue                                  */
/* ------------------------------------------------------------------ */

/** Cours publié tel que résumé pour les agrégats (issu de LmsListing). */
export interface InstructorCourseInput {
  courseId: string;
  lessonCount: number;
  durationMin: number;
  /** Plateformes où CE cours est réellement déployé et publié (Deployment). */
  platforms: readonly string[];
  /** Inscrits au cours sur le LMS interne (Enrollment). */
  studentCount: number;
}

export interface InstructorStats {
  courseCount: number;
  lessonCount: number;
  /** Durée cumulée du catalogue, en minutes. */
  totalDurationMin: number;
  /** Heures de contenu, arrondies au dixième (affichage). */
  totalHours: number;
  /** Inscrits cumulés (LMS interne uniquement — aucune donnée plateforme tierce). */
  studentCount: number;
  /** Plateformes distinctes couvertes par au moins un cours, triées. */
  platforms: string[];
}

/** Agrégats du catalogue public d'un instructeur. PURE. */
export function aggregateInstructorStats(
  courses: readonly InstructorCourseInput[],
): InstructorStats {
  const platforms = new Set<string>();
  let lessonCount = 0;
  let totalDurationMin = 0;
  let studentCount = 0;

  for (const course of courses) {
    lessonCount += Math.max(0, course.lessonCount);
    totalDurationMin += Math.max(0, course.durationMin);
    studentCount += Math.max(0, course.studentCount);
    for (const platform of course.platforms) platforms.add(platform);
  }

  return {
    courseCount: courses.length,
    lessonCount,
    totalDurationMin,
    totalHours: Math.round((totalDurationMin / 60) * 10) / 10,
    studentCount,
    platforms: [...platforms].sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Avis (LMS interne UNIQUEMENT)                                       */
/* ------------------------------------------------------------------ */

/**
 * Avis RÉEL laissé par un apprenant inscrit sur le LMS interne (CourseReview).
 * Les « avis Udemy » du worker (deploy/feedback-loop.ts) sont MOCKÉS : ils ne
 * sont jamais agrégés ici ni affichés publiquement.
 */
export interface InstructorReviewInput {
  rating: number;
  comment?: string;
}

export interface ReviewAggregate {
  count: number;
  /** Moyenne arrondie au dixième. */
  average: number;
  /** Nombre d'avis par note (1 à 5). */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/**
 * Agrège des avis réels. Retourne null s'il n'y en a AUCUN : l'appelant ne doit
 * alors afficher aucune section « avis » (décision produit : pas de section
 * vide, pas d'avis simulés). Les notes hors bornes 1–5 sont ignorées. PURE.
 */
export function aggregateReviews(
  reviews: readonly InstructorReviewInput[],
): ReviewAggregate | null {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;

  for (const review of reviews) {
    const rating = Math.round(review.rating);
    if (rating < 1 || rating > 5 || !Number.isFinite(rating)) continue;
    distribution[rating as 1 | 2 | 3 | 4 | 5] += 1;
    sum += rating;
    count += 1;
  }

  if (count === 0) return null;
  return { count, average: Math.round((sum / count) * 10) / 10, distribution };
}

/**
 * Nom d'affichage d'un auteur d'avis : « Prénom I. » (jamais l'email, jamais le
 * nom complet). Vide/inconnu → libellé anonyme fourni par l'appelant. PURE.
 */
export function reviewerDisplayName(fullName: string, anonymousLabel: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return anonymousLabel;
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first!;
}

/* ------------------------------------------------------------------ */
/* JSON-LD (schema.org) — construit ici, injecté par la page publique  */
/* ------------------------------------------------------------------ */

export interface InstructorJsonLdCourse {
  title: string;
  summary: string;
  /** URL absolue de la page du cours (LMS interne). */
  url: string;
}

export interface InstructorJsonLdInput {
  name: string;
  handle: string;
  headline?: string;
  bio?: string;
  expertise?: readonly string[];
  /** URL absolue du site (APP_URL). */
  siteUrl: string;
  courses: readonly InstructorJsonLdCourse[];
  /** Agrégat des avis RÉELS — omis du JSON-LD s'il n'y en a aucun. */
  reviews: ReviewAggregate | null;
}

/** JSON-LD Person (l'instructeur) — objet sérialisable tel quel. PURE. */
export function instructorPersonJsonLd(input: InstructorJsonLdInput): Record<string, unknown> {
  const url = `${input.siteUrl.replace(/\/+$/, '')}${instructorPath(input.handle)}`;
  const person: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.name,
    url,
    mainEntityOfPage: { '@type': 'ProfilePage', '@id': url },
  };
  if (input.headline) person.jobTitle = input.headline;
  if (input.bio) person.description = input.bio;
  if (input.expertise && input.expertise.length > 0) person.knowsAbout = [...input.expertise];
  if (input.reviews) {
    person.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: input.reviews.average,
      reviewCount: input.reviews.count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return person;
}

/** JSON-LD ItemList du catalogue publié — null si aucun cours publié. PURE. */
export function instructorCoursesJsonLd(
  input: InstructorJsonLdInput,
): Record<string, unknown> | null {
  if (input.courses.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Cours de ${input.name}`,
    numberOfItems: input.courses.length,
    itemListElement: input.courses.map((course, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Course',
        name: course.title,
        description: course.summary,
        url: course.url,
        provider: { '@type': 'Organization', name: 'SallyCourse' },
      },
    })),
  };
}
