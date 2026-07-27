import { z } from 'zod';

/**
 * Blog SEO automatique par cours (Prompt 204) : logique PURE (aucune I/O).
 *
 * Pour chaque cours PUBLIÉ sur le LMS interne, un plan éditorial produit N
 * articles SEO (mot-clé cible + intention de recherche), maillés entre eux et
 * publiés à cadence régulière à partir de la date de publication du cours.
 *
 * Ce module porte : les schémas du plan et des articles, le calcul des dates de
 * publication étalées, le maillage interne, le rendu des blocs Markdown ajoutés
 * (liens internes + CTA cours) et la validation SEO. Les I/O (Mongo, LLM,
 * scheduler) restent dans le worker et les routes.
 */

/* ------------------------------------------------------------------ */
/* Bornes et défauts (surchargeables par env, cf. config.ts)           */
/* ------------------------------------------------------------------ */

export const BLOG = {
  /** Articles générés par cours publié (défaut — BLOG_POSTS_PER_COURSE). */
  DEFAULT_POSTS_PER_COURSE: 6,
  /** Jours entre deux publications (défaut — BLOG_CADENCE_DAYS : 1 par semaine). */
  DEFAULT_CADENCE_DAYS: 7,
  /** Longueur minimale d'un article SEO, hors blocs de code. */
  MIN_WORDS: 1200,
  /** Plafond de rédaction (évite les pavés dilués). */
  MAX_WORDS: 2200,
  /** Sections H2 minimales (structure indispensable au SEO). */
  MIN_H2_SECTIONS: 4,
  /** Occurrences minimales du mot-clé cible dans le corps (densité minimale). */
  MIN_KEYWORD_OCCURRENCES: 3,
  /** Bornes de la meta description (Google tronque au-delà de ~160 caractères). */
  META_DESCRIPTION_MIN_CHARS: 70,
  META_DESCRIPTION_MAX_CHARS: 160,
  /** Questions minimales de la FAQ (bloc FAQPage schema.org). */
  MIN_FAQ_ENTRIES: 2,
  MAX_FAQ_ENTRIES: 6,
  /** Liens internes posés vers d'autres articles du même cours. */
  INTERNAL_LINKS_PER_POST: 2,
  /** Articles par page de l'index /blog. */
  PAGE_SIZE: 10,
} as const;

/* ------------------------------------------------------------------ */
/* Plan éditorial (1 appel LLM) et contenu d'article (1 appel/article) */
/* ------------------------------------------------------------------ */

/** Intention de recherche visée — pilote l'angle rédactionnel et le CTA. */
export const SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

/** Une entrée du plan éditorial : un article à rédiger. */
export const blogPlanEntrySchema = z.object({
  title: z.string().min(1).max(120),
  /** Mot-clé (ou expression) cible unique de l'article. */
  keyword: z.string().min(2).max(80),
  searchIntent: z.enum(SEARCH_INTENTS),
  /** Angle éditorial en une phrase — évite deux articles redondants. */
  angle: z.string().min(1).max(300),
});
export type BlogPlanEntry = z.infer<typeof blogPlanEntrySchema>;

export const blogPlanSchema = z.object({
  posts: z.array(blogPlanEntrySchema).min(1).max(24),
});
export type BlogPlan = z.infer<typeof blogPlanSchema>;

/**
 * Contenu d'un article SEO produit par le LLM. `faq` alimente le JSON-LD
 * FAQPage de la page publique ; `metaDescription` la balise <meta>.
 */
export const blogPostContentSchema = z.object({
  title: z.string().min(1).max(120),
  metaDescription: z.string().min(1).max(BLOG.META_DESCRIPTION_MAX_CHARS),
  /** Corps de l'article en Markdown : H2/H3 uniquement (pas de H1). */
  markdown: z.string().min(1),
  faq: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        answer: z.string().min(1).max(800),
      }),
    )
    .min(BLOG.MIN_FAQ_ENTRIES)
    .max(BLOG.MAX_FAQ_ENTRIES),
});
export type BlogPostContent = z.infer<typeof blogPostContentSchema>;

/** Statuts du cycle de vie d'un article (miroir du modèle BlogPost). */
export const BLOG_POST_STATUSES = ['draft', 'scheduled', 'published'] as const;
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Slugs                                                               */
/* ------------------------------------------------------------------ */

/** Slug ASCII d'un titre d'article (minuscules, accents retirés, tirets). */
export function blogSlugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    // Diacritiques (bloc combinatoire) supprimés après décomposition NFKD.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'article';
}

/**
 * Slug unique : suffixe -2, -3… tant que le slug est déjà pris. `taken` est la
 * liste des slugs DÉJÀ attribués (base + articles du même lot en cours).
 */
export function uniqueBlogSlug(title: string, taken: readonly string[]): string {
  const base = blogSlugify(title);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Improbable (999 homonymes) : suffixe temporel pour rester unique.
  return `${base}-${Date.now()}`;
}

/* ------------------------------------------------------------------ */
/* Calendrier de publication étalée                                    */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dates de publication étalées : le 1er article part à la publication du cours,
 * les suivants tous les `cadenceDays` jours. `coursePublishedAt` reste la
 * référence FIXE de tous les calculs (pas de dérive cumulative si un passage du
 * cron est en retard) — même principe que computeNextSendAt (email-sequence).
 */
export function computeBlogSchedule(
  coursePublishedAt: Date,
  count: number,
  cadenceDays: number = BLOG.DEFAULT_CADENCE_DAYS,
): Date[] {
  const total = Math.max(0, Math.trunc(count));
  const cadence = Math.max(0, Math.trunc(cadenceDays));
  return Array.from(
    { length: total },
    (_unused, index) => new Date(coursePublishedAt.getTime() + index * cadence * DAY_MS),
  );
}

/** Statut initial d'un article selon son échéance (échéance passée = publié). */
export function blogPostStatusFor(scheduledFor: Date, now: Date): BlogPostStatus {
  return scheduledFor.getTime() <= now.getTime() ? 'published' : 'scheduled';
}

/** Forme minimale d'un article pour la sélection des échéances (pure). */
export interface BlogPostSchedulingInfo {
  id: string;
  status: BlogPostStatus;
  scheduledFor: Date;
}

/** Articles programmés dont l'échéance est atteinte (à publier maintenant). */
export function selectDueBlogPosts<T extends BlogPostSchedulingInfo>(posts: readonly T[], now: Date): T[] {
  return posts.filter((post) => post.status === 'scheduled' && post.scheduledFor.getTime() <= now.getTime());
}

/* ------------------------------------------------------------------ */
/* Maillage interne                                                    */
/* ------------------------------------------------------------------ */

/**
 * Maillage circulaire : chaque article pointe vers les `linksPerPost` suivants
 * (modulo la liste). Garantit qu'AUCUN article n'est orphelin dès 2 articles,
 * sans auto-lien ni doublon. Un seul article → aucun lien interne.
 */
export function computeInternalLinks(
  slugs: readonly string[],
  linksPerPost: number = BLOG.INTERNAL_LINKS_PER_POST,
): string[][] {
  const total = slugs.length;
  const perPost = Math.max(0, Math.min(Math.trunc(linksPerPost), total - 1));
  return slugs.map((_unused, index) =>
    Array.from({ length: perPost }, (_u, offset) => slugs[(index + offset + 1) % total]!),
  );
}

/** Un article cible du maillage (slug + titre affiché dans le lien). */
export interface BlogLinkTarget {
  slug: string;
  title: string;
}

/**
 * Bloc Markdown « À lire aussi » ajouté en fin d'article (maillage interne).
 * Chaîne vide si aucun lien (article seul) — rien n'est appendu dans ce cas.
 */
export function renderInternalLinksSection(targets: readonly BlogLinkTarget[]): string {
  if (targets.length === 0) return '';
  const items = targets.map((t) => `- [${t.title}](/blog/${t.slug})`).join('\n');
  return `\n\n## À lire aussi\n\n${items}\n`;
}

/**
 * Bloc CTA Markdown vers la page publique du cours sur le LMS interne — ajouté
 * en fin d'article (après le maillage). `courseUrl` est un chemin relatif
 * (/learn/{id}) ou une URL absolue selon l'appelant.
 */
export function renderCourseCta(courseTitle: string, courseUrl: string): string {
  return [
    '',
    '',
    '## Aller plus loin avec le cours complet',
    '',
    `Cet article couvre l'essentiel, mais la pratique guidée fait la différence. Le cours **${courseTitle}** reprend ces notions pas à pas, avec des vidéos, des exercices corrigés et des quiz.`,
    '',
    `👉 [Découvrir le cours « ${courseTitle} »](${courseUrl})`,
    '',
  ].join('\n');
}

/**
 * Article final = corps rédigé + maillage interne + CTA cours. Fonction pure :
 * c'est ce Markdown COMPLET qui est persisté puis rendu sur /blog/[slug].
 */
export function assembleBlogMarkdown(params: {
  body: string;
  links: readonly BlogLinkTarget[];
  courseTitle: string;
  courseUrl: string;
}): string {
  return (
    params.body.trimEnd() +
    renderInternalLinksSection(params.links) +
    renderCourseCta(params.courseTitle, params.courseUrl)
  );
}

/* ------------------------------------------------------------------ */
/* Validation SEO (règles métier au-delà du schéma Zod)                */
/* ------------------------------------------------------------------ */

/** Compte les mots d'un Markdown, blocs de code fencés exclus. */
export function countBlogWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Normalise pour la comparaison de mot-clé : minuscules, accents retirés. */
function normalizeForKeyword(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Occurrences (insensibles à la casse et aux accents) du mot-clé dans un texte. */
export function countKeywordOccurrences(text: string, keyword: string): number {
  const needle = normalizeForKeyword(keyword).trim();
  if (!needle) return 0;
  const haystack = normalizeForKeyword(text);
  let count = 0;
  let from = 0;
  for (let i = haystack.indexOf(needle, from); i !== -1; i = haystack.indexOf(needle, from)) {
    count += 1;
    from = i + needle.length;
  }
  return count;
}

/**
 * Règles SEO au-delà du schéma : volume de mots, structure H2, absence de H1,
 * présence du mot-clé cible (titre + densité minimale dans le corps), longueur
 * de la meta description, taille de la FAQ. Retourne la liste des problèmes
 * (vide = conforme) — réinjectée au LLM en cas d'échec (patron article.ts).
 */
export function validateBlogSeo(post: BlogPostContent, keyword: string): string[] {
  const problems: string[] = [];
  const { markdown, title, metaDescription, faq } = post;

  const words = countBlogWords(markdown);
  if (words < BLOG.MIN_WORDS) {
    problems.push(`L'article fait ${words} mots (hors code) — il en faut au moins ${BLOG.MIN_WORDS}.`);
  } else if (words > BLOG.MAX_WORDS) {
    problems.push(`L'article fait ${words} mots (hors code) — il en faut au plus ${BLOG.MAX_WORDS}.`);
  }

  const h2Count = (markdown.match(/^##\s+/gm) ?? []).length;
  if (h2Count < BLOG.MIN_H2_SECTIONS) {
    problems.push(
      `L'article contient ${h2Count} section(s) H2 (##) — il en faut au moins ${BLOG.MIN_H2_SECTIONS}.`,
    );
  }

  if (/^#\s+/m.test(markdown)) {
    problems.push('Le Markdown contient un titre H1 (#) — le titre est fourni à part, commence aux H2 (##).');
  }

  if (countKeywordOccurrences(title, keyword) === 0) {
    problems.push(`Le titre ne contient pas le mot-clé cible « ${keyword} ».`);
  }

  const occurrences = countKeywordOccurrences(markdown, keyword);
  if (occurrences < BLOG.MIN_KEYWORD_OCCURRENCES) {
    problems.push(
      `Le mot-clé cible « ${keyword} » apparaît ${occurrences} fois dans le corps — il en faut au moins ${BLOG.MIN_KEYWORD_OCCURRENCES}.`,
    );
  }

  if (metaDescription.length < BLOG.META_DESCRIPTION_MIN_CHARS) {
    problems.push(
      `La meta description fait ${metaDescription.length} caractères — il en faut au moins ${BLOG.META_DESCRIPTION_MIN_CHARS}.`,
    );
  }

  if (faq.length < BLOG.MIN_FAQ_ENTRIES) {
    problems.push(`La FAQ compte ${faq.length} question(s) — il en faut au moins ${BLOG.MIN_FAQ_ENTRIES}.`);
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* JSON-LD (schema.org) — construit ici, injecté par la page publique  */
/* ------------------------------------------------------------------ */

/** Données minimales d'un article publié nécessaires au JSON-LD. */
export interface BlogPostJsonLdInput {
  title: string;
  metaDescription: string;
  slug: string;
  publishedAt: Date;
  updatedAt: Date;
  authorName: string;
  /** URL absolue du site (APP_URL) — préfixe des URLs canoniques. */
  siteUrl: string;
  faq: readonly { question: string; answer: string }[];
  /** Page publique du cours sur le LMS (CTA + mention isPartOf). */
  courseUrl: string;
  courseTitle: string;
}

/** JSON-LD BlogPosting (article) — objet sérialisable tel quel. */
export function blogPostingJsonLd(input: BlogPostJsonLdInput): Record<string, unknown> {
  const url = `${input.siteUrl.replace(/\/+$/, '')}/blog/${input.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: input.title,
    description: input.metaDescription,
    datePublished: input.publishedAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    author: { '@type': 'Person', name: input.authorName },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    about: { '@type': 'Course', name: input.courseTitle, url: input.courseUrl },
  };
}

/** JSON-LD FAQPage (bloc FAQ de l'article) — null si aucune question. */
export function blogFaqJsonLd(faq: readonly { question: string; answer: string }[]): Record<string, unknown> | null {
  if (faq.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
