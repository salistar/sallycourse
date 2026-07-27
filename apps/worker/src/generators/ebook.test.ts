import { describe, expect, it } from 'vitest';
import {
  buildEbookHtml,
  buildEpub,
  buildEpubNcx,
  buildEpubOpf,
  embedChapterImages,
  tokenizeMarkdownImages,
  type EbookChapter,
  type EpubImageFile,
} from './ebook.js';

const chapters: EbookChapter[] = [
  { title: 'Introduction & <bases>', html: '<h2>Leçon 1</h2>\n<p>Contenu.</p>' },
  { title: 'Aller plus loin', html: '<h2>Leçon 2</h2>\n<p>Suite.</p>' },
];

describe('buildEbookHtml (P201)', () => {
  it('produit un document complet : couverture, sommaire, chapitres ancrés', () => {
    const html = buildEbookHtml('Mon cours', chapters);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="cover"');
    expect(html).toContain('Sommaire');
    expect(html).toContain('id="ch0"');
    expect(html).toContain('id="ch1"');
    expect(html).toContain('<h2>Leçon 1</h2>');
  });

  it('échappe le HTML des titres (pas d’injection)', () => {
    const html = buildEbookHtml('Cours & Cie', chapters);
    expect(html).toContain('Introduction &amp; &lt;bases&gt;');
  });
});

describe('tokenizeMarkdownImages (correctif 1.7, audit 2026-07-20)', () => {
  it('résout le chemin relatif en clé de stockage absolue et remplace par un jeton isolé', () => {
    const md = 'Avant.\n\n![Terminal montrant la sortie](./sections/1/lessons/2/screenshots/0.png)\n\nAprès.';
    const { markdown, images } = tokenizeMarkdownImages(md, 'course-1', (() => {
      let i = 0;
      return () => i++;
    })());
    expect(markdown).not.toContain('![');
    expect(markdown).not.toContain('.png');
    expect(images).toHaveLength(1);
    expect(images[0]!.key).toBe('courses/course-1/sections/1/lessons/2/screenshots/0.png');
    expect(images[0]!.caption).toBe('Terminal montrant la sortie');
    expect(markdown).toContain(images[0]!.token);
  });

  it('garde une référence sans clé pour une image sans légende (repli possible malgré tout)', () => {
    let i = 0;
    const { images } = tokenizeMarkdownImages('a ![](x.png) b', 'course-1', () => i++);
    expect(images).toHaveLength(1);
    expect(images[0]!.caption).toBe('');
    expect(images[0]!.key).toBe('courses/course-1/x.png');
  });

  it('ne touche pas aux liens Markdown normaux', () => {
    const md = 'Voir [la doc](https://exemple.org).';
    let i = 0;
    const { markdown, images } = tokenizeMarkdownImages(md, 'course-1', () => i++);
    expect(markdown).toBe(md);
    expect(images).toHaveLength(0);
  });

  it('des jetons distincts pour plusieurs images, compteur partagé', () => {
    let i = 0;
    const nextIndex = () => i++;
    const a = tokenizeMarkdownImages('![Un](./a.png)', 'c', nextIndex);
    const b = tokenizeMarkdownImages('![Deux](./b.png)', 'c', nextIndex);
    expect(a.images[0]!.token).not.toBe(b.images[0]!.token);
  });
});

describe('embedChapterImages (correctif 1.7)', () => {
  it('remplace le paragraphe-jeton par le rendu fourni, sans toucher au reste du HTML', () => {
    let i = 0;
    const { markdown, images } = tokenizeMarkdownImages('![Capture](./x.png)', 'c1', () => i++);
    const html = `<h2>Titre</h2>\n${markdown.replace(/\n\n/g, '\n')
      .split('\n')
      .filter(Boolean)
      .map((l) => `<p>${l}</p>`)
      .join('\n')}`;
    const out = embedChapterImages(html, images, (img) => `<figure>${img.caption}</figure>`);
    expect(out).toContain('<figure>Capture</figure>');
    expect(out).toContain('<h2>Titre</h2>');
    expect(out).not.toContain(images[0]!.token);
  });

  it("ne modifie rien s'il n'y a aucune image", () => {
    const html = '<p>Rien à voir ici.</p>';
    expect(embedChapterImages(html, [], () => 'X')).toBe(html);
  });
});

describe('buildEpub (P201)', () => {
  it('produit un ZIP dont la 1re entrée est `mimetype` NON compressé (exigence EPUB)', async () => {
    const buf = await buildEpub('course-1', 'Mon cours', 'fr', chapters);
    // Signature ZIP
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    // mimetype stocké en clair, tout au début de l'archive
    const head = buf.subarray(0, 120).toString('latin1');
    expect(head).toContain('mimetype');
    expect(head).toContain('application/epub+zip');
    expect(buf.length).toBeGreaterThan(200);
  });

  it('refuse un livre sans chapitre (spine/navMap vides = EPUB invalide)', async () => {
    await expect(buildEpub('course-1', 'Vide', 'fr', [])).rejects.toThrow(/au moins un chapitre/);
  });

  describe('images embarquées (correctif 1.7, audit 2026-07-20)', () => {
    const png = (byte: number): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]);
    const img: EpubImageFile = { id: 'SALLYCOURSE_EBOOK_IMG_0', ext: 'png', data: png(1) };
    const cover: EpubImageFile = { id: 'cover-img', ext: 'png', data: png(2) };

    it("l'archive contient le fichier de chaque image sous OEBPS/images/", async () => {
      const buf = await buildEpub('course-1', 'Mon cours', 'fr', chapters, [img]);
      const asText = buf.toString('latin1');
      expect(asText).toContain('OEBPS/images/SALLYCOURSE_EBOOK_IMG_0.png');
    });

    it("déclare la cover et l'ajoute à l'archive", async () => {
      const buf = await buildEpub('course-1', 'Mon cours', 'fr', chapters, [], cover);
      const asText = buf.toString('latin1');
      expect(asText).toContain('OEBPS/images/cover-img.png');
    });

    it('sans images ni cover : comportement inchangé (pas de dossier images)', async () => {
      const buf = await buildEpub('course-1', 'Mon cours', 'fr', chapters);
      expect(buf.toString('latin1')).not.toContain('OEBPS/images/');
    });
  });
});

describe('identité du livre : OPF + NCX (P201)', () => {
  it('identifie le livre par le courseId : deux cours HOMONYMES ne collisionnent pas', () => {
    const a = buildEpubOpf('course-A', 'Introduction à Python', 'fr', chapters);
    const b = buildEpubOpf('course-B', 'Introduction à Python', 'fr', chapters);
    expect(a).toContain('<dc:identifier id="bookid">urn:sallycourse:course:course-A</dc:identifier>');
    expect(b).toContain('<dc:identifier id="bookid">urn:sallycourse:course:course-B</dc:identifier>');
  });

  it('garde l’identifiant STABLE si le cours est renommé (ce n’est pas un nouveau livre)', () => {
    const avant = buildEpubOpf('course-A', 'Titre initial', 'fr', chapters);
    const apres = buildEpubOpf('course-A', 'Titre remanié', 'fr', chapters);
    expect(avant).toContain('urn:sallycourse:course:course-A');
    expect(apres).toContain('urn:sallycourse:course:course-A');
  });

  it('garde `dtb:uid` (NCX) IDENTIQUE au `dc:identifier` (OPF), comme l’exige EPUB 2', () => {
    const opf = buildEpubOpf('course-42', 'Mon cours', 'fr', chapters);
    const ncx = buildEpubNcx('course-42', 'Mon cours', chapters);
    const uid = /<dc:identifier id="bookid">([^<]+)<\/dc:identifier>/.exec(opf)?.[1];
    expect(uid).toBeTruthy();
    expect(ncx).toContain(`<meta name="dtb:uid" content="${uid}"/>`);
  });

  it('le spine et le navMap contiennent un élément par chapitre', () => {
    const opf = buildEpubOpf('c1', 'T', 'fr', chapters);
    const ncx = buildEpubNcx('c1', 'T', chapters);
    expect(opf.split('<itemref ').length - 1).toBe(chapters.length);
    expect(ncx.split('<navPoint ').length - 1).toBe(chapters.length);
  });

  describe('manifest images + cover (correctif 1.7, audit 2026-07-20)', () => {
    const img: EpubImageFile = { id: 'SALLYCOURSE_EBOOK_IMG_0', ext: 'png', data: Buffer.from('x') };

    it('déclare chaque image dans le manifest avec le bon media-type', () => {
      const opf = buildEpubOpf('c1', 'T', 'fr', chapters, [img]);
      expect(opf).toContain('<item id="SALLYCOURSE_EBOOK_IMG_0" href="images/SALLYCOURSE_EBOOK_IMG_0.png" media-type="image/png"/>');
    });

    it('déclare la cover via <meta name="cover"> (convention EPUB 2, pas properties="cover-image")', () => {
      const opf = buildEpubOpf('c1', 'T', 'fr', chapters, [img], img.id);
      expect(opf).toContain(`<meta name="cover" content="${img.id}"/>`);
      expect(opf).not.toContain('properties="cover-image"');
    });

    it('sans images : aucun changement du manifest (comportement inchangé)', () => {
      const withImages = buildEpubOpf('c1', 'T', 'fr', chapters, [img]);
      const without = buildEpubOpf('c1', 'T', 'fr', chapters);
      expect(without).not.toContain('media-type="image/png"');
      expect(without.length).toBeLessThan(withImages.length);
    });
  });
});
