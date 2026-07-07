// Tests du générateur de ressources téléchargeables (Prompt 65) : contrat
// courseResourcesContentSchema, fixture mock déterministe, agrégation PURE
// (glossaire → cartes cheatsheet, TP → sections workbook), et génération
// mockée du contenu LLM (SDK Anthropic mocké — aucune requête réseau).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

// Le SDK est mocké au niveau module : aucune requête réseau possible.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import {
  courseResourcesContentSchema,
  resetConfigCache,
  type CourseResourcesContent,
  type TpContent,
} from '../shared.js';
import { resetClaudeClientForTests } from '../lib/claude.js';
import { extractTitleFromPrompt, mockCourseResources } from '../lib/mock-fixtures.js';
import { mockTpContent } from './tp.js';
import { resourcesSystemPrompt, resourcesUserPrompt } from '../prompts/resources.js';
import {
  buildCheatsheetSections,
  buildOutlineSummary,
  buildWorkbookSectionsHtml,
  generateResourcesContent,
  renderCheatsheetPdf,
  renderWorkbookPdf,
  tpToWorkbookSectionHtml,
} from './resources.js';

const COURSE_TITLE = 'Apprendre Docker de zéro';

/** Environnement complet et valide pour getConfig (aucun accès réseau). */
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
    MOCK_PROVIDERS: 'false',
    ...overrides,
  });
  resetConfigCache();
}

/** Réponse Messages API minimale (bloc texte unique). */
function textResponse(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' };
}

beforeEach(() => {
  mockCreate.mockReset();
  resetClaudeClientForTests();
  setTestEnv();
});

describe('mockCourseResources', () => {
  it('est déterministe par titre et conforme au schéma', () => {
    expect(mockCourseResources(COURSE_TITLE)).toEqual(mockCourseResources(COURSE_TITLE));
    expect(courseResourcesContentSchema.safeParse(mockCourseResources(COURSE_TITLE)).success).toBe(true);
  });

  it('produit un glossaire trié alphabétiquement et non vide', () => {
    const content = mockCourseResources(COURSE_TITLE);
    const terms = content.glossary.map((g) => g.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(content.glossary.length).toBeGreaterThanOrEqual(5);
  });

  it('produit des ressources complémentaires distinctes', () => {
    const content = mockCourseResources(COURSE_TITLE);
    expect(content.furtherResources.length).toBeGreaterThanOrEqual(3);
    const titles = new Set(content.furtherResources.map((r) => r.title));
    expect(titles.size).toBe(content.furtherResources.length);
  });
});

describe('generateResourcesContent', () => {
  const input = {
    courseTitle: COURSE_TITLE,
    subtitle: 'Conteneurs, images et orchestration',
    difficulty: 'beginner',
    locale: 'fr',
    outlineSummary: '1. Découverte — Installer Docker, Premier conteneur',
  } as const;

  it('mode mock : fixture locale conforme, zéro appel API', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const content = await generateResourcesContent(input);
    expect(courseResourcesContentSchema.safeParse(content).success).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clé API absente : bascule aussi sur la fixture mock', async () => {
    setTestEnv({ ANTHROPIC_API_KEY: '' });
    const content = await generateResourcesContent(input);
    expect(content).toEqual(mockCourseResources(COURSE_TITLE));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('mode réel : appelle Claude et valide la réponse contre le schéma', async () => {
    const payload: CourseResourcesContent = mockCourseResources(COURSE_TITLE);
    mockCreate.mockResolvedValueOnce(textResponse(payload));

    const content = await generateResourcesContent(input);
    expect(content).toEqual(payload);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('prompts resources', () => {
  it('resourcesUserPrompt balise le titre du cours en premier « … » (extraction mock)', () => {
    const user = resourcesUserPrompt({
      courseTitle: COURSE_TITLE,
      difficulty: 'beginner',
      locale: 'fr',
      outlineSummary: '1. Découverte — Installer Docker',
    });
    expect(extractTitleFromPrompt(user)).toBe(COURSE_TITLE);
    expect(user).toContain('Installer Docker');
  });

  it('resourcesSystemPrompt décrit le contrat JSON (glossary + furtherResources)', () => {
    const system = resourcesSystemPrompt();
    expect(system).toContain('"glossary"');
    expect(system).toContain('"furtherResources"');
    expect(system).toContain('UNIQUEMENT avec un objet JSON');
  });
});

describe('buildOutlineSummary', () => {
  it('groupe les leçons par section, triées par ordre', () => {
    const sections = [
      { _id: 's2', title: 'Section B', order: 1 },
      { _id: 's1', title: 'Section A', order: 0 },
    ];
    const lessons = [
      { title: 'Leçon A2', sectionId: 's1', order: 1 },
      { title: 'Leçon A1', sectionId: 's1', order: 0 },
      { title: 'Leçon B1', sectionId: 's2', order: 0 },
    ];
    const summary = buildOutlineSummary(sections, lessons);
    const lines = summary.split('\n');
    expect(lines[0]).toContain('Section A');
    expect(lines[0]).toContain('Leçon A2, Leçon A1');
    expect(lines[1]).toContain('Section B');
    expect(lines[1]).toContain('Leçon B1');
  });

  it('gère une section sans leçon (aucun tiret superflu)', () => {
    const summary = buildOutlineSummary([{ _id: 's1', title: 'Section vide', order: 0 }], []);
    expect(summary).toBe('1. Section vide');
  });
});

describe('buildCheatsheetSections', () => {
  it('regroupe le glossaire en cartes de 10 entrées maximum', () => {
    const content: CourseResourcesContent = {
      glossary: Array.from({ length: 25 }, (_, i) => ({
        term: `Terme ${String(i).padStart(2, '0')}`,
        definition: `Définition ${i}`,
      })),
      furtherResources: mockCourseResources(COURSE_TITLE).furtherResources,
    };
    const sections = buildCheatsheetSections(content);
    expect(sections.length).toBe(3);
    expect(sections[0]?.items.length).toBe(10);
    expect(sections[1]?.items.length).toBe(10);
    expect(sections[2]?.items.length).toBe(5);
    // Titres numérotés uniquement quand il y a plusieurs cartes.
    expect(sections[0]?.title).toBe('Glossaire (1/3)');
  });

  it('une seule carte « Glossaire » (sans numérotation) sous le seuil', () => {
    const content = mockCourseResources(COURSE_TITLE);
    const sections = buildCheatsheetSections(content);
    expect(sections.length).toBe(1);
    expect(sections[0]?.title).toBe('Glossaire');
    expect(sections[0]?.items.length).toBe(content.glossary.length);
  });
});

describe('tpToWorkbookSectionHtml', () => {
  it('inclut objectif, étapes, commande et espace de réponse', () => {
    const tp: TpContent = mockTpContent('TP : les fondamentaux');
    const html = tpToWorkbookSectionHtml(1, 'Leçon TP', tp);
    expect(html).toContain('class="wb-section"');
    expect(html).toContain('class="wb-section-index"');
    expect(html).toContain('01');
    expect(html).toContain('Leçon TP');
    expect(html).toContain('class="wb-objective"');
    expect(html).toContain('class="wb-steps"');
    expect(html).toContain('class="wb-answer"');
    expect(html).toContain('class="wb-lines lines-4"');
    // Au moins une étape a une commande (fixture mockTpContent).
    expect(html).toContain('class="wb-code"');
  });

  it('échappe le HTML du contenu (pas d\'injection brute)', () => {
    const tp: TpContent = {
      ...mockTpContent('x'),
      objective: '<script>alert(1)</script>',
    };
    const html = tpToWorkbookSectionHtml(1, 'Leçon', tp);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildWorkbookSectionsHtml', () => {
  it('concatène une section par TP', () => {
    const lessons = [
      { title: 'TP 1', script: mockTpContent('TP 1') },
      { title: 'TP 2', script: mockTpContent('TP 2') },
    ];
    const html = buildWorkbookSectionsHtml(lessons);
    expect((html.match(/class="wb-section"/g) ?? []).length).toBe(2);
    expect(html).toContain('TP 1');
    expect(html).toContain('TP 2');
  });

  it('retourne une section « aucun TP » quand la liste est vide', () => {
    const html = buildWorkbookSectionsHtml([]);
    expect(html).toContain('Aucun TP dans ce cours');
  });
});

describe('rendu PDF (mode mock, sans navigateur)', () => {
  it('renderCheatsheetPdf produit un buffer PDF minimal en mock', async () => {
    const content = mockCourseResources(COURSE_TITLE);
    const pdf = await renderCheatsheetPdf(
      {
        lang: 'fr',
        direction: 'ltr',
        courseTitle: COURSE_TITLE,
        docTitle: 'Aide-mémoire',
        sections: buildCheatsheetSections(content),
      },
      true,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renderWorkbookPdf produit un buffer PDF minimal en mock', async () => {
    const pdf = await renderWorkbookPdf(
      {
        lang: 'fr',
        direction: 'ltr',
        courseTitle: COURSE_TITLE,
        docTitle: 'Workbook',
        sectionsHtml: buildWorkbookSectionsHtml([]),
      },
      true,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
