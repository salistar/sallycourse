// Tests du générateur de blog SEO (Prompt 204) en mode MOCK (zéro appel
// réseau) : plan éditorial déterministe, article conforme aux règles SEO
// (validateBlogSeo, logique pure testée dans packages/shared), et cohérence
// des fixtures avec les prompts (extraction du mot-clé / du nombre d'articles).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BLOG,
  blogPlanSchema,
  blogPostContentSchema,
  countBlogWords,
  resetConfigCache,
  validateBlogSeo,
} from '../shared.js';
import {
  extractBlogKeywordFromPrompt,
  extractBlogPostCountFromPrompt,
  mockBlogPlan,
  mockBlogPost,
} from '../lib/mock-fixtures.js';
import { blogPlanUserPrompt, blogPostUserPrompt } from '../prompts/blog.js';
import { courseLearnUrl, generateBlogPlan, generateBlogPostContent } from './blog.js';

/** Environnement complet et valide pour getConfig, en mode mock (zéro appel réseau). */
function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MOCK_PROVIDERS: 'true',
    ...overrides,
  });
  resetConfigCache();
}

beforeEach(() => setTestEnv());
afterEach(() => {
  delete process.env.BLOG_POSTS_PER_COURSE;
  delete process.env.LMS_BASE_URL;
  resetConfigCache();
});

const COURSE = 'Kubernetes en production';

describe('mockBlogPlan', () => {
  it('produit un plan conforme au schéma avec le nombre demandé d’articles', () => {
    const plan = mockBlogPlan(COURSE, 6);
    expect(blogPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.posts).toHaveLength(6);
  });

  it('n’attribue jamais deux fois le même mot-clé', () => {
    const keywords = mockBlogPlan(COURSE, 12).posts.map((p) => p.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it('est déterministe pour un même cours', () => {
    expect(mockBlogPlan(COURSE, 6)).toEqual(mockBlogPlan(COURSE, 6));
  });
});

describe('mockBlogPost', () => {
  const keyword = 'débuter avec kubernetes';
  const post = mockBlogPost('Débuter avec Kubernetes : le guide complet', keyword);

  it('produit un contenu conforme à blogPostContentSchema', () => {
    expect(blogPostContentSchema.safeParse(post).success).toBe(true);
  });

  it('respecte toutes les règles SEO du générateur', () => {
    expect(validateBlogSeo(post, keyword)).toEqual([]);
  });

  it(`fait au moins ${BLOG.MIN_WORDS} mots hors blocs de code`, () => {
    const words = countBlogWords(post.markdown);
    expect(words).toBeGreaterThanOrEqual(BLOG.MIN_WORDS);
    expect(words).toBeLessThanOrEqual(BLOG.MAX_WORDS);
  });

  it('force le mot-clé dans le titre même si le titre ne le contient pas', () => {
    const forced = mockBlogPost('Un titre neutre', 'tests de charge');
    expect(forced.title.toLowerCase()).toContain('tests de charge');
  });
});

describe('extraction depuis les prompts (cohérence fixtures ↔ prompts)', () => {
  it('retrouve le nombre d’articles demandé dans le prompt de plan', () => {
    const user = blogPlanUserPrompt({
      courseTitle: COURSE,
      difficulty: 'intermediate',
      locale: 'fr',
      count: 4,
    });
    expect(extractBlogPostCountFromPrompt(user)).toBe(4);
  });

  it('retrouve le mot-clé cible dans le prompt d’article', () => {
    const user = blogPostUserPrompt({
      title: 'Débuter avec Kubernetes',
      keyword: 'débuter avec kubernetes',
      searchIntent: 'informational',
      angle: 'Poser les bases.',
      courseTitle: COURSE,
      difficulty: 'beginner',
      locale: 'fr',
    });
    expect(extractBlogKeywordFromPrompt(user)).toBe('débuter avec kubernetes');
  });

  it('retombe sur des valeurs par défaut si le prompt ne dit rien', () => {
    expect(extractBlogPostCountFromPrompt('prompt sans rien')).toBe(BLOG.DEFAULT_POSTS_PER_COURSE);
  });
});

describe('generateBlogPlan (mode mock)', () => {
  it('retourne un plan du nombre demandé sans appel réseau', async () => {
    const plan = await generateBlogPlan({
      courseTitle: COURSE,
      difficulty: 'intermediate',
      locale: 'fr',
      count: 3,
    });
    expect(plan.posts).toHaveLength(3);
    expect(blogPlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe('generateBlogPostContent (mode mock)', () => {
  it('produit un article SEO conforme, sans violation', async () => {
    const { post, violations } = await generateBlogPostContent({
      entry: {
        title: 'Débuter avec Kubernetes : le guide complet pour bien démarrer',
        keyword: 'débuter avec kubernetes',
        searchIntent: 'informational',
        angle: 'Poser les bases pour un lecteur qui part de zéro.',
      },
      courseTitle: COURSE,
      difficulty: 'beginner',
      locale: 'fr',
    });
    expect(violations).toEqual([]);
    expect(blogPostContentSchema.safeParse(post).success).toBe(true);
    expect(countBlogWords(post.markdown)).toBeGreaterThanOrEqual(BLOG.MIN_WORDS);
    // Le CTA et le maillage sont appendus APRÈS la rédaction (logique pure) :
    // le corps produit par le LLM n'en contient aucun.
    expect(post.markdown).not.toContain('## À lire aussi');
  });
});

describe('courseLearnUrl', () => {
  it('pointe vers la page publique du cours sur le LMS', () => {
    expect(courseLearnUrl('abc123')).toBe('/learn/abc123');
    process.env.LMS_BASE_URL = 'https://sallycourse.app/';
    expect(courseLearnUrl('abc123')).toBe('https://sallycourse.app/learn/abc123');
  });
});
