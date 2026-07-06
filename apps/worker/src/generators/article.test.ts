// Tests du générateur d'articles (Prompt 16) : fixture mock conforme à
// articleContentSchema et aux règles rédactionnelles, validations métier
// (longueur, H2, encadrés, placeholders) et court-circuit MOCK_PROVIDERS.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARTICLE,
  articleContentSchema,
  extractScreenshotPlaceholders,
  resetConfigCache,
  type ArticleContent,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { mockArticle } from '../lib/mock-fixtures.js';
import { articleSystemPrompt, articleUserPrompt } from '../prompts/article.js';
import { countArticleWords, generateArticleContent, validateArticleBusiness } from './article.js';

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
afterEach(() => resetConfigCache());

const TITLE = 'Mémo : les concepts clés';

/** Article synthétique valide, ajustable pour provoquer chaque violation. */
function validArticle(): ArticleContent {
  return articleContentSchema.parse(mockArticle(TITLE));
}

describe('mockArticle', () => {
  it('produit un contenu conforme à articleContentSchema', () => {
    expect(articleContentSchema.safeParse(mockArticle(TITLE)).success).toBe(true);
  });

  it('respecte toutes les règles rédactionnelles du générateur', () => {
    expect(validateArticleBusiness(validArticle())).toEqual([]);
  });

  it(`tient entre ${ARTICLE.MIN_WORDS} et ${ARTICLE.MAX_WORDS} mots hors blocs de code`, () => {
    const words = countArticleWords(mockArticle(TITLE).markdown);
    expect(words).toBeGreaterThanOrEqual(ARTICLE.MIN_WORDS);
    expect(words).toBeLessThanOrEqual(ARTICLE.MAX_WORDS);
  });

  it('est déterministe : même titre → même article', () => {
    expect(mockArticle(TITLE)).toEqual(mockArticle(TITLE));
  });

  it('contient des placeholders de captures exploitables', () => {
    const placeholders = extractScreenshotPlaceholders(mockArticle(TITLE).markdown);
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
    for (const description of placeholders) expect(description.length).toBeGreaterThan(10);
  });
});

describe('countArticleWords', () => {
  it('exclut les blocs de code fencés du décompte', () => {
    const md = 'un deux trois\n```js\nconst quatre = 5;\nconsole.log(quatre);\n```\nsix sept';
    expect(countArticleWords(md)).toBe(5);
  });
});

describe('validateArticleBusiness', () => {
  it('signale un article trop court', () => {
    const article = { title: TITLE, markdown: '## A\n\n## B\n\n> **À retenir** : x\n\n{{screenshot:une capture du terminal}}' };
    const problems = validateArticleBusiness(article);
    expect(problems.some((p) => p.includes('au moins ' + ARTICLE.MIN_WORDS))).toBe(true);
  });

  it('signale un article trop long', () => {
    const article = validArticle();
    article.markdown += `\n\n${'mot '.repeat(ARTICLE.MAX_WORDS)}`;
    expect(validateArticleBusiness(article).some((p) => p.includes('au plus'))).toBe(true);
  });

  it('signale un nombre de sections H2 insuffisant', () => {
    const article = validArticle();
    // Rétrograde toutes les H2 en H3 : structure plate non conforme.
    article.markdown = article.markdown.replace(/^##\s/gm, '### ');
    expect(validateArticleBusiness(article).some((p) => p.includes('H2'))).toBe(true);
  });

  it('signale l’absence d’encadré "> **À retenir**"', () => {
    const article = validArticle();
    article.markdown = article.markdown.replace(/^>\s*\*\*À retenir\*\*/gm, '> **Note**');
    expect(validateArticleBusiness(article).some((p) => p.includes('À retenir'))).toBe(true);
  });

  it('signale l’absence de placeholder {{screenshot:…}}', () => {
    const article = validArticle();
    article.markdown = article.markdown.replace(/\{\{screenshot:[^}]+\}\}/g, '');
    expect(validateArticleBusiness(article).some((p) => p.includes('screenshot'))).toBe(true);
  });
});

describe('prompts article + callClaudeJson en mode mock', () => {
  const promptInput = {
    lessonTitle: 'Guide de référence — le débogage',
    courseTitle: 'JavaScript moderne',
    summary: 'Savoir lire une stack trace et isoler un bug.',
    difficulty: 'intermediate' as const,
    locale: 'fr' as const,
  };

  it('balise le titre de la leçon « … » en tête du prompt utilisateur', () => {
    const user = articleUserPrompt(promptInput);
    expect(user.startsWith(`Rédige l'article de la leçon « ${promptInput.lessonTitle} »`)).toBe(true);
    expect(user).toContain(promptInput.courseTitle);
    expect(user).toContain(promptInput.summary);
  });

  it('impose bornes, encadrés et placeholders dans le prompt système', () => {
    const system = articleSystemPrompt();
    expect(system).toContain(String(ARTICLE.MIN_WORDS));
    expect(system).toContain(String(ARTICLE.MAX_WORDS));
    expect(system).toContain('**À retenir**');
    expect(system).toContain('{{screenshot:');
  });

  it('retourne une fixture conforme, calée sur la leçon demandée', async () => {
    const article = await callClaudeJson({
      schema: articleContentSchema,
      system: articleSystemPrompt(),
      user: articleUserPrompt(promptInput),
    });
    expect(articleContentSchema.safeParse(article).success).toBe(true);
    expect(article.title).toContain('débogage');
    expect(validateArticleBusiness(article)).toEqual([]);
  });

  it('generateArticleContent converge en mode mock sans violation restante', async () => {
    const { article, violations } = await generateArticleContent(promptInput);
    expect(violations).toEqual([]);
    expect(countArticleWords(article.markdown)).toBeGreaterThanOrEqual(ARTICLE.MIN_WORDS);
    expect(extractScreenshotPlaceholders(article.markdown).length).toBeGreaterThanOrEqual(1);
  });
});
