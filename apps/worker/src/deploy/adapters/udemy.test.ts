// Tests de la logique PURE de l'adapter Udemy : slug, mapping catégorie,
// checkpoint, objectifs, conversion Markdown. Aucun appel réseau/navigateur.
import { describe, expect, it } from 'vitest';
import {
  buildCourseSlug,
  mockCourseUrl,
  normalizeCategory,
  mockCategoryFor,
  shouldUploadLesson,
  courseObjectives,
  sessionStateKey,
  sessionScopeId,
  markdownToBasicHtml,
  udemyCategorySchema,
  UDEMY_CATEGORIES,
} from './udemy.js';
import type { ICourse, ISection } from '../../shared.js';

describe('buildCourseSlug', () => {
  it('minuscule, retire accents et compacte les tirets', () => {
    expect(buildCourseSlug('Créer une API Node.js — Débutant')).toBe('creer-une-api-node-js-debutant');
  });

  it('rogne les tirets de bord', () => {
    expect(buildCourseSlug('  !!! Salut !!!  ')).toBe('salut');
  });

  it('retombe sur « cours » quand le titre ne produit rien', () => {
    expect(buildCourseSlug('***')).toBe('cours');
    expect(buildCourseSlug('')).toBe('cours');
  });
});

describe('mockCourseUrl', () => {
  it('construit une URL udemy.com/course/{slug}/', () => {
    expect(mockCourseUrl('Mon Super Cours')).toBe('https://www.udemy.com/course/mon-super-cours/');
  });
});

describe('normalizeCategory', () => {
  it('accepte une catégorie exacte (insensible à la casse)', () => {
    expect(normalizeCategory('development')).toBe('Development');
    expect(normalizeCategory('Finance & Accounting')).toBe('Finance & Accounting');
  });

  it('retombe sur la catégorie par défaut pour une valeur inconnue ou vide', () => {
    expect(normalizeCategory('Cuisine moléculaire')).toBe('Teaching & Academics');
    expect(normalizeCategory(undefined)).toBe('Teaching & Academics');
    expect(normalizeCategory(null)).toBe('Teaching & Academics');
  });

  it('produit toujours une valeur du schéma', () => {
    expect(udemyCategorySchema.safeParse({ category: normalizeCategory('web') }).success).toBe(true);
  });
});

describe('mockCategoryFor', () => {
  it('mappe par mots-clés du titre', () => {
    expect(mockCategoryFor({ title: 'Apprendre React et les API web' })).toBe('Development');
    expect(mockCategoryFor({ title: 'Comptabilité et fiscalité pour freelance' })).toBe('Finance & Accounting');
    expect(mockCategoryFor({ title: 'Yoga et nutrition' })).toBe('Health & Fitness');
  });

  it('défaut Teaching & Academics sans mot-clé', () => {
    expect(mockCategoryFor({ title: 'Histoire de la Rome antique' })).toBe('Teaching & Academics');
  });

  it('reste dans la taxonomie officielle', () => {
    expect(UDEMY_CATEGORIES).toContain(mockCategoryFor({ title: 'peu importe' }));
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

describe('courseObjectives', () => {
  const baseCourse = { title: 'Cours test' } as unknown as ICourse;

  it('privilégie les objectifs de l’outline', () => {
    const course = { ...baseCourse, outline: { learningObjectives: ['A', 'B'] } } as unknown as ICourse;
    expect(courseObjectives(course, [])).toEqual(['A', 'B']);
  });

  it('dérive des titres de sections sans outline', () => {
    const sections = [{ title: 'Bases' }, { title: 'Avancé' }] as unknown as ISection[];
    expect(courseObjectives(baseCourse, sections)).toEqual(['Maîtriser : Bases', 'Maîtriser : Avancé']);
  });

  it('fournit toujours au moins un objectif', () => {
    expect(courseObjectives(baseCourse, [])).toEqual(['Suivre le cours « Cours test »']);
  });
});

describe('sessionStateKey', () => {
  it('produit une clé stable par portée', () => {
    expect(sessionStateKey('u1')).toBe('deploy/udemy/session-u1.enc');
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
