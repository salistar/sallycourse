// Tests des helpers PURS de l'export Common Cartridge (Prompt 101) : validité
// du manifeste IMS CC 1.3 (balises équilibrées, échappement XML), assemblage
// des items (leçons + quiz QTI), et structure du ZIP produit (noms d'entrées
// lus depuis les en-têtes locaux du binaire, sans lib de dézippage). Aucun
// accès réseau ni stockage : la source de contenu est mockée.

import { describe, expect, it } from 'vitest';
import type { ILesson } from '../shared.js';
import {
  buildCartridgeItems,
  buildCommonCartridge,
  buildCommonCartridgeManifest,
  cartridgeLessonBodyHtml,
  cartridgePageDocument,
  cartridgeQuizQti,
  COMMON_CARTRIDGE_VERSION,
  type CartridgeCourseModel,
  type CartridgeQuizQuestion,
  type CartridgeSource,
} from './common-cartridge.js';

/** Leçon factice minimale (champs lus par le générateur Common Cartridge). */
function fakeLesson(over: Partial<ILesson>): ILesson {
  return {
    sectionId: over.sectionId ?? ('sec1' as unknown as ILesson['sectionId']),
    courseId: 'c1' as unknown as ILesson['courseId'],
    order: over.order ?? 0,
    title: over.title ?? 'Leçon',
    type: over.type ?? 'article',
    status: 'ready',
    assets: over.assets ?? { screenshots: [], slides: [] },
    summary: over.summary,
  } as ILesson;
}

const quiz = (): CartridgeQuizQuestion[] => [
  { question: 'Question 1 ?', choices: ['A', 'B', 'C', 'D'], correctIndex: 2, explanation: 'Parce que.' },
  { question: 'Question 2 ?', choices: ['Vrai', 'Faux'], correctIndex: 0 },
];

/** Modèle de cours de test : 2 sections, 3 leçons, un quiz sur la section 0. */
function model(): CartridgeCourseModel {
  return {
    courseId: 'course-abc123',
    title: 'Cours de Démo & Test',
    locale: 'fr',
    sections: [
      { id: 'sec0', order: 0, title: 'Introduction' },
      { id: 'sec1', order: 1, title: 'Approfondissement' },
    ],
    lessons: [
      fakeLesson({ sectionId: 'sec0' as unknown as ILesson['sectionId'], order: 0, title: 'Bienvenue', type: 'article' }),
      fakeLesson({ sectionId: 'sec0' as unknown as ILesson['sectionId'], order: 1, title: 'Démo vidéo', type: 'video' }),
      fakeLesson({ sectionId: 'sec1' as unknown as ILesson['sectionId'], order: 0, title: 'Aller plus loin', type: 'article' }),
    ],
    quizzesBySection: new Map([['sec0', quiz()]]),
  };
}

/** Source de contenu mockée : article Markdown fixe, vidéo présente pour la leçon vidéo. */
const source: CartridgeSource = {
  async readArticle() {
    return '# Titre\n\nUn **paragraphe** avec du `code`.';
  },
  async videoKey(lesson) {
    return lesson.type === 'video' ? 'courses/course-abc123/sections/0/lessons/1/video.mp4' : null;
  },
};

/** Extrait les noms de fichiers déclarés dans les en-têtes locaux d'un ZIP (PK\x03\x04). */
function listZipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
  let offset = 0;
  while (offset < buf.length) {
    const idx = buf.indexOf(sig, offset);
    if (idx === -1) break;
    // Structure de l'en-tête local ZIP (offsets relatifs à idx) :
    // 26-27 = nameLen (uint16 LE), 28-29 = extraLen (uint16 LE), nom ensuite.
    const nameLen = buf.readUInt16LE(idx + 26);
    const nameStart = idx + 30;
    const name = buf.toString('utf-8', nameStart, nameStart + nameLen);
    names.push(name);
    offset = nameStart + nameLen;
  }
  return names;
}

describe('buildCartridgeItems', () => {
  it('produit un item par leçon plus un quiz QTI par section pourvue', async () => {
    const items = await buildCartridgeItems(model(), source);
    // 3 leçons + 1 quiz (section 0) = 4 items.
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.title)).toEqual([
      'Bienvenue',
      'Démo vidéo',
      'Quiz — Introduction',
      'Aller plus loin',
    ]);
    expect(items.map((i) => i.id)).toEqual(['item_1', 'item_2', 'item_3', 'item_4']);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('marque le quiz en kind "qti" et les leçons en "webcontent"', async () => {
    const items = await buildCartridgeItems(model(), source);
    const quizItem = items.find((i) => i.title.startsWith('Quiz'))!;
    expect(quizItem.kind).toBe('qti');
    expect(quizItem.href).toMatch(/\.xml$/);
    for (const it of items.filter((i) => i !== quizItem)) {
      expect(it.kind).toBe('webcontent');
      expect(it.href).toMatch(/\.html$/);
    }
  });

  it('joint la vidéo comme asset de la leçon vidéo uniquement', async () => {
    const items = await buildCartridgeItems(model(), source);
    const video = items.find((i) => i.title === 'Démo vidéo')!;
    expect(video.assets).toHaveLength(1);
    expect(video.assets[0]!.path).toMatch(/^assets\/.*\.mp4$/);
    expect(video.assets[0]!.sourceKey).toContain('video.mp4');
    expect(items.find((i) => i.title === 'Bienvenue')!.assets).toHaveLength(0);
  });

  it('ordonne les sections par order (quiz de sec0 avant leçon de sec1)', async () => {
    const items = await buildCartridgeItems(model(), source);
    const quizIdx = items.findIndex((i) => i.title.startsWith('Quiz'));
    const sec1Idx = items.findIndex((i) => i.title === 'Aller plus loin');
    expect(quizIdx).toBeLessThan(sec1Idx);
  });

  it('ignore les sections sans quiz valide (moins de 2 choix)', async () => {
    const m = model();
    m.quizzesBySection.set('sec1', [{ question: 'Q', choices: ['seul'], correctIndex: 0 }]);
    const items = await buildCartridgeItems(m, source);
    // Toujours 4 items : le quiz sec1 invalide n'est pas ajouté.
    expect(items).toHaveLength(4);
  });
});

describe('buildCommonCartridgeManifest', () => {
  it('génère un XML bien formé (déclaration, balises équilibrées)', async () => {
    const items = await buildCartridgeItems(model(), source);
    const xml = buildCommonCartridgeManifest(model(), items);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<schemaversion>${COMMON_CARTRIDGE_VERSION}</schemaversion>`);
    // Un <item> et un <resource> par item du modèle.
    expect((xml.match(/<item identifier="item_ref_/g) ?? []).length).toBe(items.length);
    expect((xml.match(/<resource /g) ?? []).length).toBe(items.length);
    // Balises principales ouvertes/fermées symétriquement.
    for (const tag of ['manifest', 'organizations', 'organization', 'resources']) {
      expect((xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length).toBe(1);
      expect(xml).toContain(`</${tag}>`);
    }
    // Le titre contenant « & » est échappé (pas de & brut hors entité).
    expect(xml).toContain('Cours de Démo &amp; Test');
    expect(/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml)).toBe(false);
  });

  it('référence chaque href de ressource et type correctement le quiz QTI', async () => {
    const items = await buildCartridgeItems(model(), source);
    const xml = buildCommonCartridgeManifest(model(), items);
    for (const it of items) {
      expect(xml).toContain(`href="${it.href}"`);
    }
    expect(xml).toContain('imsqti_xmlv1p2/imscc_xmlv1p1/assessment');
    // Les items webcontent (leçons) utilisent le type par défaut.
    const webcontentCount = (xml.match(/type="webcontent"/g) ?? []).length;
    expect(webcontentCount).toBe(items.filter((i) => i.kind === 'webcontent').length);
  });
});

describe('cartridgeLessonBodyHtml', () => {
  it('rend un <video> pour une leçon vidéo', () => {
    const html = cartridgeLessonBodyHtml(fakeLesson({ type: 'video' }), 'assets/01.mp4', null);
    expect(html).toContain('<video');
    expect(html).toContain('src="assets/01.mp4"');
  });

  it('convertit le Markdown pour une leçon article', () => {
    const html = cartridgeLessonBodyHtml(fakeLesson({ type: 'article' }), null, '# Titre\n\nTexte.');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<p>Texte.</p>');
  });

  it('repli explicite quand aucun contenu', () => {
    const html = cartridgeLessonBodyHtml(fakeLesson({ type: 'article', summary: undefined }), null, null);
    expect(html).toContain('indisponible');
  });
});

describe('cartridgePageDocument', () => {
  it('rend une page HTML autonome sans dépendance API LMS', () => {
    const doc = cartridgePageDocument('Titre', '<p>corps</p>', 'fr');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<h1>Titre</h1>');
    expect(doc).toContain('dir="ltr"');
    // Contrairement au SCORM, aucun pont API n'est embarqué (pas de tracking LMS).
    expect(doc).not.toContain('APIWrapper.js');
  });

  it('passe en rtl pour l’arabe', () => {
    expect(cartridgePageDocument('ع', '<p></p>', 'ar')).toContain('dir="rtl"');
  });
});

describe('cartridgeQuizQti', () => {
  it('génère un XML QTI bien formé avec un <item> par question valide', () => {
    const xml = cartridgeQuizQti('Introduction', quiz(), 'assessment_intro');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<item ident=/g) ?? []).length).toBe(2);
    expect((xml.match(/<response_label ident=/g) ?? []).length).toBe(4 + 2);
    // La bonne réponse (index 2 pour Q1) est référencée.
    expect(xml).toContain('choice_2');
    expect(xml).toContain('Parce que.');
  });

  it('ignore les questions à moins de 2 choix', () => {
    const xml = cartridgeQuizQti('S', [{ question: 'Q', choices: ['seul'], correctIndex: 0 }], 'a1');
    expect((xml.match(/<item ident=/g) ?? []).length).toBe(0);
  });
});

describe('buildCommonCartridge', () => {
  it('empaquète manifeste + pages + quiz + assets dans un ZIP en mémoire', async () => {
    const m = model();
    const items = await buildCartridgeItems(m, source);

    const requestedAssets: string[] = [];
    const result = await buildCommonCartridge(m, items, async (key) => {
      requestedAssets.push(key);
      return Buffer.from('fake-bytes');
    });

    expect(result.items).toBe(items.length);
    expect(result.assets).toBe(1);
    expect(requestedAssets).toHaveLength(1);
    expect(requestedAssets[0]).toContain('video.mp4');
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(0);

    // Signature ZIP locale en tête d'archive.
    expect(result.buffer.subarray(0, 4).toString('hex')).toBe('504b0304');

    const names = listZipEntryNames(result.buffer);
    expect(names).toContain('imsmanifest.xml');
    for (const it of items) {
      expect(names).toContain(it.href);
    }
    // L'asset vidéo est bien présent sous son chemin relatif.
    const videoItem = items.find((i) => i.title === 'Démo vidéo')!;
    expect(names).toContain(videoItem.assets[0]!.path);
  });

  it('ignore un asset introuvable (provider renvoie null) sans casser le paquet', async () => {
    const m = model();
    const items = await buildCartridgeItems(m, source);
    const result = await buildCommonCartridge(m, items, async () => null);
    expect(result.assets).toBe(0);
    expect(result.items).toBe(items.length);
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});
