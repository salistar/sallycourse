// Tests de la logique PURE de l'adapter Kajabi : slug, mapping modules/posts,
// reprise sur checkpoint, isolation de session, conversion Markdown. Aucun
// appel réseau/navigateur.
import { describe, expect, it } from 'vitest';
import {
  buildProductSlug,
  mockOfferUrl,
  buildModulePlan,
  shouldUploadLesson,
  sessionStateKey,
  sessionScopeId,
  markdownToBasicHtml,
} from './kajabi.js';
import type { ILesson, ISection } from '../../shared.js';

describe('buildProductSlug', () => {
  it('minuscule, retire accents et compacte les tirets', () => {
    expect(buildProductSlug('Créer une API Node.js — Débutant')).toBe('creer-une-api-node-js-debutant');
  });

  it('rogne les tirets de bord', () => {
    expect(buildProductSlug('  !!! Salut !!!  ')).toBe('salut');
  });

  it('retombe sur « produit » quand le titre ne produit rien', () => {
    expect(buildProductSlug('***')).toBe('produit');
    expect(buildProductSlug('')).toBe('produit');
  });
});

describe('mockOfferUrl', () => {
  it('construit une URL app.kajabi.com/offers/{slug}', () => {
    expect(mockOfferUrl('Mon Super Cours')).toBe('https://app.kajabi.com/offers/mon-super-cours');
  });
});

describe('shouldUploadLesson', () => {
  it('uploade les leçons à partir du checkpoint', () => {
    expect(shouldUploadLesson(0, 2)).toBe(false);
    expect(shouldUploadLesson(1, 2)).toBe(false);
    expect(shouldUploadLesson(2, 2)).toBe(true);
    expect(shouldUploadLesson(3, 2)).toBe(true);
  });

  it('borne un checkpoint négatif à 0', () => {
    expect(shouldUploadLesson(0, -5)).toBe(true);
  });
});

describe('buildModulePlan', () => {
  const sections = [
    { _id: 'sec-2', title: 'Avancé', order: 1 },
    { _id: 'sec-1', title: 'Bases', order: 0 },
  ] as unknown as ISection[];

  const lessons = [
    { title: 'Intro', sectionId: 'sec-1', order: 0, type: 'video' },
    { title: 'Variables', sectionId: 'sec-1', order: 1, type: 'article' },
    { title: 'Boucles', sectionId: 'sec-2', order: 0, type: 'video' },
  ] as unknown as ILesson[];

  it('trie les modules par ordre de section', () => {
    const plan = buildModulePlan(sections, lessons);
    expect(plan.map((m) => m.moduleTitle)).toEqual(['Bases', 'Avancé']);
  });

  it('assigne chaque leçon à son module (index absolu préservé)', () => {
    const plan = buildModulePlan(sections, lessons);
    const bases = plan.find((m) => m.moduleTitle === 'Bases')!;
    expect(bases.posts).toEqual([
      { lessonIndex: 0, postTitle: 'Intro', type: 'video' },
      { lessonIndex: 1, postTitle: 'Variables', type: 'article' },
    ]);
    const avance = plan.find((m) => m.moduleTitle === 'Avancé')!;
    expect(avance.posts).toEqual([{ lessonIndex: 2, postTitle: 'Boucles', type: 'video' }]);
  });

  it('module sans leçon → posts vide (pas d\'erreur)', () => {
    const emptySection = [{ _id: 'sec-vide', title: 'Vide', order: 0 }] as unknown as ISection[];
    const plan = buildModulePlan(emptySection, []);
    expect(plan).toEqual([{ moduleTitle: 'Vide', moduleOrder: 0, posts: [] }]);
  });
});

describe('sessionStateKey', () => {
  it('produit une clé stable par portée', () => {
    expect(sessionStateKey('u1')).toBe('deploy/kajabi/session-u1.enc');
  });

  it('isole les sessions : deux comptes → deux clés distinctes (P49)', () => {
    expect(sessionStateKey('cred-fr')).not.toBe(sessionStateKey('cred-en'));
  });
});

describe('sessionScopeId', () => {
  it('utilise le credentialId quand présent (isolation par compte)', () => {
    const ctx = { credentialId: 'cred-42', course: { userId: 'u1' } };
    expect(sessionScopeId(ctx)).toBe('cred-42');
  });

  it("retombe sur l'userId du cours en l'absence de credentialId", () => {
    expect(sessionScopeId({ course: { userId: 'u9' } })).toBe('u9');
  });

  it('deux comptes du même utilisateur → portées de session distinctes', () => {
    const fr = sessionScopeId({ credentialId: 'cred-fr', course: { userId: 'u1' } });
    const en = sessionScopeId({ credentialId: 'cred-en', course: { userId: 'u1' } });
    expect(sessionStateKey(fr)).not.toBe(sessionStateKey(en));
  });
});

describe('markdownToBasicHtml', () => {
  it('convertit titres, listes et emphase', () => {
    const html = markdownToBasicHtml('# Titre\n\n- un\n- deux\n\nTexte **gras** et *ital*.');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>un</li>');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).toContain('<em>ital</em>');
  });

  it('échappe le HTML brut', () => {
    expect(markdownToBasicHtml('a <script>x</script> b')).toContain('&lt;script&gt;');
  });
});
