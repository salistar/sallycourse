// Tests du registre de prompts admin (Prompt 93) : fallback quand aucune
// version active n'existe en base, priorité à la version active, et
// versioning incrémental. PromptTemplate (Mongoose) est remplacé par un
// mini-modèle en mémoire — logique pure, aucune connexion Mongo réelle.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeDoc {
  key: string;
  content: string;
  version: number;
  isActive: boolean;
  createdBy: string;
}

// Collection en mémoire partagée entre les mocks et les assertions du test.
let store: FakeDoc[] = [];

function sortByVersionDesc(docs: FakeDoc[]): FakeDoc[] {
  return [...docs].sort((a, b) => b.version - a.version);
}

/** Filtre générique clé/valeur — évite les casts répétés vers Record<string, unknown>. */
function matchesFilter(doc: FakeDoc, filter: Partial<FakeDoc>): boolean {
  return (Object.entries(filter) as [keyof FakeDoc, unknown][]).every(([k, v]) => doc[k] === v);
}

vi.mock('../shared.js', () => ({
  PromptTemplate: {
    findOne: (filter: Partial<FakeDoc>) => {
      const matches = store.filter((d) => matchesFilter(d, filter));
      const sorted = sortByVersionDesc(matches);
      return {
        sort: () => ({
          lean: async () => sorted[0] ?? null,
        }),
      };
    },
    find: (filter: Partial<FakeDoc>) => {
      const matches = store.filter((d) => matchesFilter(d, filter));
      return {
        sort: () => ({
          lean: async () => sortByVersionDesc(matches),
        }),
      };
    },
    updateMany: async (filter: Partial<FakeDoc>, update: { $set: Partial<FakeDoc> }) => {
      store = store.map((d) => (matchesFilter(d, filter) ? { ...d, ...update.$set } : d));
    },
    create: async (doc: FakeDoc) => {
      store.push({ ...doc });
      return doc;
    },
  },
}));

vi.mock('../queues/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getActivePrompt, savePromptVersion, listPromptVersions, getPreviousVersion, KNOWN_PROMPT_KEYS } = await import(
  './prompt-registry.js'
);

beforeEach(() => {
  store = [];
});

describe('getActivePrompt', () => {
  it('retombe sur le fallback si aucune version en base', async () => {
    const result = await getActivePrompt('outline.system', 'PROMPT EN DUR');
    expect(result).toBe('PROMPT EN DUR');
  });

  it('retourne le contenu actif en base si présent', async () => {
    store.push({ key: 'outline.system', content: 'PROMPT ADMIN V1', version: 1, isActive: true, createdBy: 'admin@test.fr' });
    const result = await getActivePrompt('outline.system', 'PROMPT EN DUR');
    expect(result).toBe('PROMPT ADMIN V1');
  });

  it('ignore les versions inactives et retombe sur le fallback', async () => {
    store.push({ key: 'outline.system', content: 'ANCIEN', version: 1, isActive: false, createdBy: 'admin@test.fr' });
    const result = await getActivePrompt('outline.system', 'PROMPT EN DUR');
    expect(result).toBe('PROMPT EN DUR');
  });
});

describe('savePromptVersion', () => {
  it('crée la version 1 pour une clé nouvelle', async () => {
    const { version } = await savePromptVersion('quiz.system', 'contenu v1', 'admin@test.fr');
    expect(version).toBe(1);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ key: 'quiz.system', version: 1, isActive: true });
  });

  it('incrémente la version et désactive la précédente', async () => {
    await savePromptVersion('quiz.system', 'contenu v1', 'admin@test.fr');
    const { version } = await savePromptVersion('quiz.system', 'contenu v2', 'admin@test.fr');

    expect(version).toBe(2);
    const versions = await listPromptVersions('quiz.system');
    expect(versions).toHaveLength(2);

    const v1 = versions.find((v) => v.version === 1);
    const v2 = versions.find((v) => v.version === 2);
    expect(v1?.isActive).toBe(false);
    expect(v2?.isActive).toBe(true);
  });

  it('ne mélange pas le versioning entre deux clés distinctes', async () => {
    await savePromptVersion('quiz.system', 'a', 'admin@test.fr');
    const { version } = await savePromptVersion('article.system', 'b', 'admin@test.fr');
    expect(version).toBe(1);
  });
});

describe('getPreviousVersion', () => {
  it('retourne null si une seule version existe', async () => {
    await savePromptVersion('tp.system', 'v1', 'admin@test.fr');
    expect(await getPreviousVersion('tp.system')).toBeNull();
  });

  it('retourne la version juste avant la version active (comparaison A/B)', async () => {
    await savePromptVersion('tp.system', 'v1', 'admin@test.fr');
    await savePromptVersion('tp.system', 'v2', 'admin@test.fr');
    const previous = await getPreviousVersion('tp.system');
    expect(previous?.version).toBe(1);
    expect(previous?.content).toBe('v1');
  });
});

describe('KNOWN_PROMPT_KEYS', () => {
  it('couvre au moins les générateurs système/utilisateur existants', () => {
    expect(KNOWN_PROMPT_KEYS).toContain('outline.system');
    expect(KNOWN_PROMPT_KEYS).toContain('outline.user');
    expect(KNOWN_PROMPT_KEYS.length).toBeGreaterThanOrEqual(14);
  });
});
