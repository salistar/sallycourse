// Blog SEO automatique par cours (Prompt 204). Déclenché à la PUBLICATION d'un
// cours sur le LMS interne (deploy/adapters/lms.ts) :
//
//  1) UN appel LLM produit le plan éditorial (N mots-clés / intentions) ;
//  2) UN appel LLM par article rédige le contenu, avec la boucle retry+feedback
//     du générateur d'article de leçon (callClaudeJson + validateBlogSeo) mais
//     un prompt SEO distinct (mot-clé cible, intention, H2/H3, FAQ) ;
//  3) le maillage interne et le CTA vers /learn/{courseId} sont appendus par la
//     logique PURE de @sallycourse/shared/blog, puis les articles sont persistés
//     avec leur échéance de publication étalée (1 par semaine par défaut).
//
// Les coûts LLM (plan + articles) sont rattachés au CostContext { courseId,
// userId } existant. Mode mock : fixtures déterministes, aucun appel réseau.
import {
  BLOG,
  BlogPost,
  Course,
  LmsListing,
  assembleBlogMarkdown,
  blogPlanSchema,
  blogPostContentSchema,
  computeBlogSchedule,
  computeInternalLinks,
  blogPostStatusFor,
  countBlogWords,
  getConfig,
  uniqueBlogSlug,
  validateBlogSeo,
  type BlogLinkTarget,
  type BlogPlan,
  type BlogPlanEntry,
  type BlogPostContent,
  type Difficulty,
  type Locale,
  type Outline,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import type { CostContext } from '../lib/cost.js';
import { mockBlogPlan } from '../lib/mock-fixtures.js';
import { logger } from '../queues/index.js';
import {
  blogPlanSystemPrompt,
  blogPlanUserPrompt,
  blogPostSystemPrompt,
  blogPostUserPrompt,
} from '../prompts/blog.js';

/** Tentatives quand les règles SEO échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Un article de 2200 mots + FAQ tient largement dans ce budget de sortie. */
const BLOG_POST_MAX_TOKENS = 8192;

/** Base publique du LMS interne (même source que l'adapter LMS). */
function lmsBaseUrl(): string {
  const raw = process.env.LMS_BASE_URL?.trim();
  return (raw && raw.replace(/\/+$/, '')) || '';
}

/** URL de la page publique du cours — cible du CTA et du JSON-LD. */
export function courseLearnUrl(courseId: string): string {
  return `${lmsBaseUrl()}/learn/${courseId}`;
}

export interface BlogPlanInput {
  courseTitle: string;
  courseDescription?: string | undefined;
  learningObjectives?: readonly string[] | undefined;
  difficulty: Difficulty;
  locale: Locale;
  count: number;
  cost?: CostContext | undefined;
  llmProviderId?: string | null | undefined;
}

/**
 * Plan éditorial du blog d'un cours (1 appel LLM). Repli déterministe sur la
 * fixture en mode mock ET en cas d'échec du LLM (patron promo-calendar) : un
 * plan générique reste toujours préférable à une publication sans blog.
 */
export async function generateBlogPlan(input: BlogPlanInput): Promise<BlogPlan> {
  const config = getConfig();
  if (config.MOCK_PROVIDERS) return mockBlogPlan(input.courseTitle, input.count);

  try {
    const plan = await callClaudeJson<BlogPlan>({
      schema: blogPlanSchema,
      system: blogPlanSystemPrompt(),
      user: blogPlanUserPrompt(input),
      ...(input.cost ? { cost: input.cost } : {}),
      llmProviderId: input.llmProviderId,
    });
    return plan;
  } catch (err) {
    logger.warn(
      { courseTitle: input.courseTitle, err: (err as Error).message },
      'blog : plan éditorial LLM échoué — repli fixture déterministe',
    );
    return mockBlogPlan(input.courseTitle, input.count);
  }
}

export interface BlogPostInput {
  entry: BlogPlanEntry;
  courseTitle: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Titres des autres articles du lot (anti-doublon de contenu). */
  siblingTitles?: readonly string[] | undefined;
  cost?: CostContext | undefined;
  llmProviderId?: string | null | undefined;
}

/**
 * Cœur pur d'un article (testable sans Mongo) : prompt SEO → LLM → règles SEO
 * avec retry + feedback. Règles SOUPLES, comme le générateur d'article de leçon :
 * après MAX_BUSINESS_ATTEMPTS le dernier candidat (toujours conforme au schéma)
 * est accepté avec un warn plutôt que de faire échouer la publication.
 */
export async function generateBlogPostContent(
  input: BlogPostInput,
): Promise<{ post: BlogPostContent; violations: string[] }> {
  const system = blogPostSystemPrompt();
  const baseUser = blogPostUserPrompt({
    title: input.entry.title,
    keyword: input.entry.keyword,
    searchIntent: input.entry.searchIntent,
    angle: input.entry.angle,
    courseTitle: input.courseTitle,
    difficulty: input.difficulty,
    locale: input.locale,
    siblingTitles: input.siblingTitles,
  });

  let post: BlogPostContent | null = null;
  let violations: string[] = [];

  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      violations.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${violations
            .map((p) => `- ${p}`)
            .join('\n')}`;

    post = await callClaudeJson({
      schema: blogPostContentSchema,
      system,
      user,
      maxTokens: BLOG_POST_MAX_TOKENS,
      // Retry métier : le feedback peut être identique d'une tentative à l'autre
      // — sans skipCache, la 2e rejouerait la réponse mise en cache (P72).
      skipCache: attempt > 1,
      ...(input.cost ? { cost: input.cost } : {}),
      llmProviderId: input.llmProviderId,
    });

    violations = validateBlogSeo(post, input.entry.keyword);
    if (violations.length === 0) break;
    logger.warn(
      { title: input.entry.title, attempt, problems: violations },
      'blog : article non conforme aux règles SEO',
    );
  }

  // Garde théorique : la boucle affecte toujours post avant de sortir.
  if (!post) throw new Error(`génération d'article de blog sans candidat pour « ${input.entry.title} »`);
  if (violations.length > 0) {
    logger.warn(
      { title: input.entry.title, problems: violations },
      `blog : article accepté malgré ${violations.length} règle(s) SEO insatisfaite(s)`,
    );
  }
  return { post, violations };
}

export interface CourseBlogResult {
  courseId: string;
  /** Articles persistés (plan éditorial complet). */
  created: number;
  /** Articles dont l'échéance était déjà atteinte (publiés immédiatement). */
  publishedNow: number;
  slugs: string[];
  words: number;
}

/**
 * Génère (ou REgénère) le blog SEO complet d'un cours publié : plan éditorial,
 * N articles, maillage interne, CTA, calendrier de publication étalé. Tout le
 * contenu est rédigé EN MÉMOIRE avant la moindre écriture (aucun demi-blog en
 * cas d'échec), et une régénération PRÉSERVE le slug/statut/date des articles
 * déjà publiés (mêmes mots-clés) pour ne pas casser les URLs indexées. Jette en
 * cas d'échec — l'appelant (scheduler / adapter LMS) traite l'appel en best-effort.
 */
export async function generateCourseBlog(params: { courseId: string }): Promise<CourseBlogResult> {
  const { courseId } = params;
  const config = getConfig();

  const course = await Course.findById(courseId).select('_id userId title difficulty locale outline llmProvider').lean();
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  // Date de référence du calendrier : la publication du cours sur le LMS.
  const listing = await LmsListing.findOne({ courseId }).select('publishedAt').lean();
  const coursePublishedAt = listing?.publishedAt ?? new Date();

  const outline = (course.outline ?? undefined) as Outline | undefined;
  const cost: CostContext = { courseId, userId: String(course.userId) };
  const count = config.BLOG_POSTS_PER_COURSE;

  // ── 1) Plan éditorial (1 appel LLM) ─────────────────────────────
  const plan = await generateBlogPlan({
    courseTitle: course.title,
    courseDescription: outline?.description,
    learningObjectives: outline?.learningObjectives,
    difficulty: course.difficulty,
    locale: course.locale,
    count,
    cost,
    llmProviderId: course.llmProvider,
  });
  const entries = plan.posts.slice(0, count);
  if (entries.length === 0) throw new Error(`plan éditorial vide pour le cours ${courseId}`);

  // ── 2) Rédaction de TOUS les articles EN MÉMOIRE (1 appel LLM chacun) ──
  // On génère l'intégralité du contenu AVANT toute écriture en base : si un
  // article échoue (generateBlogPostContent n'a pas de repli), on jette sans
  // avoir rien supprimé — jamais de demi-blog laissé en base (intégrité).
  const posts: Awaited<ReturnType<typeof generateBlogPostContent>>['post'][] = [];
  for (const [index, entry] of entries.entries()) {
    const { post } = await generateBlogPostContent({
      entry,
      courseTitle: course.title,
      difficulty: course.difficulty,
      locale: course.locale,
      siblingTitles: entries.filter((_e, i) => i !== index).map((e) => e.title),
      cost,
      llmProviderId: course.llmProvider,
    });
    posts.push(post);
  }

  // ── 3) Slugs : on PRÉSERVE le slug d'un article déjà PUBLIÉ (même mot-clé) ──
  // Régénérer ne doit pas casser les URLs indexées ni les liens externes : un
  // article déjà publié garde son slug, son statut et sa date de publication.
  // Les autres reçoivent un slug neuf, unique vis-à-vis des AUTRES cours et des
  // slugs déjà attribués dans ce lot.
  const existingPosts = await BlogPost.find({ courseId })
    .select('slug keyword status scheduledFor publishedAt')
    .lean();
  const publishedByKeyword = new Map(
    existingPosts.filter((p) => p.status === 'published').map((p) => [p.keyword, p]),
  );
  const takenSlugs = (await BlogPost.find({ courseId: { $ne: courseId } }).select('slug').lean()).map((p) => p.slug);

  const now = new Date();
  const schedule = computeBlogSchedule(coursePublishedAt, entries.length, config.BLOG_CADENCE_DAYS);

  const slugs: string[] = [];
  const reused: Array<(typeof existingPosts)[number] | undefined> = [];
  for (const entry of entries) {
    const keep = publishedByKeyword.get(entry.keyword);
    if (keep) {
      slugs.push(keep.slug);
      reused.push(keep);
    } else {
      slugs.push(uniqueBlogSlug(entry.title, [...takenSlugs, ...slugs]));
      reused.push(undefined); // article neuf : calendrier/statut calculés
    }
  }

  const linkSlugs = computeInternalLinks(slugs, BLOG.INTERNAL_LINKS_PER_POST);
  const titleBySlug = new Map(slugs.map((slug, index) => [slug, entries[index]!.title]));
  const courseUrl = courseLearnUrl(courseId);

  // ── 4) Construction des documents EN MÉMOIRE ────────────────────
  let publishedNow = 0;
  let words = 0;
  const docs = entries.map((entry, index) => {
    const post = posts[index]!;
    const slug = slugs[index]!;
    const links: BlogLinkTarget[] = (linkSlugs[index] ?? []).map((target) => ({
      slug: target,
      title: titleBySlug.get(target) ?? target,
    }));
    const markdown = assembleBlogMarkdown({ body: post.markdown, links, courseTitle: course.title, courseUrl });
    words += countBlogWords(markdown);

    const keep = reused[index];
    const scheduledFor = keep ? keep.scheduledFor : schedule[index]!;
    const status = keep ? 'published' : blogPostStatusFor(scheduledFor, now);
    if (status === 'published') publishedNow += 1;

    return {
      courseId,
      userId: course.userId,
      slug,
      title: post.title,
      keyword: entry.keyword,
      searchIntent: entry.searchIntent,
      metaDescription: post.metaDescription,
      markdown,
      faq: post.faq,
      status,
      order: index,
      scheduledFor,
      ...(status === 'published' ? { publishedAt: keep?.publishedAt ?? now } : {}),
      internalLinks: links.map((l) => l.slug),
    };
  });

  // ── 5) Remplacement : tout le contenu est prêt, la fenêtre destructive est
  // minimale (suppression puis insertion GROUPÉE, aucun appel LLM entre les deux).
  await BlogPost.deleteMany({ courseId });
  await BlogPost.insertMany(docs);

  const result: CourseBlogResult = {
    courseId,
    created: entries.length,
    publishedNow,
    slugs,
    words,
  };
  logger.info(result, 'blog SEO généré et programmé');
  return result;
}
