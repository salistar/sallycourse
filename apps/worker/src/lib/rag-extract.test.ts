// Tests d'extraction de contenu (Prompt 90, RAG simple) : Markdown (réelle,
// sans dépendance), repli dégradé PDF/PPTX (libs 'pdf-parse'/'jszip' absentes
// dans ce monorepo — comportement documenté, testé tel quel).
import { describe, expect, it } from 'vitest';
import {
  extractMarkdown,
  extractPdf,
  extractPptx,
  extractPrintableStringsFallback,
  extractSourceMaterialText,
  extractTextTagsFromXml,
} from './rag-extract.js';

describe('extractMarkdown', () => {
  it('lit le texte Markdown tel quel (mode full)', () => {
    const buffer = Buffer.from('# Titre\n\nParagraphe de cours.', 'utf8');
    const result = extractMarkdown(buffer);
    expect(result.mode).toBe('full');
    expect(result.text).toBe('# Titre\n\nParagraphe de cours.');
  });
});

describe('extractPrintableStringsFallback', () => {
  it('extrait les séquences de caractères imprimables suffisamment longues', () => {
    const buffer = Buffer.concat([
      Buffer.from('Introduction au cours', 'utf8'),
      Buffer.from([0x00, 0x01, 0x02]),
      Buffer.from('Deuxieme partie visible', 'utf8'),
      Buffer.from([0x00]),
      Buffer.from('ab'), // trop court (< 4), doit être ignoré
    ]);
    const text = extractPrintableStringsFallback(buffer);
    expect(text).toContain('Introduction au cours');
    expect(text).toContain('Deuxieme partie visible');
    expect(text).not.toContain('ab ');
  });

  it('retourne une chaîne vide pour un buffer sans texte exploitable', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(extractPrintableStringsFallback(buffer)).toBe('');
  });
});

describe('extractTextTagsFromXml', () => {
  it('extrait le contenu des balises <a:t> et décode les entités XML', () => {
    const xml =
      '<p:sp><a:t>Titre de la slide</a:t></p:sp><p:sp><a:t>Bullet &amp; point</a:t></p:sp>';
    const text = extractTextTagsFromXml(xml);
    expect(text).toBe('Titre de la slide Bullet & point');
  });

  it('retourne une chaîne vide si aucune balise <a:t>', () => {
    expect(extractTextTagsFromXml('<p:sp></p:sp>')).toBe('');
  });
});

describe('extractPdf — repli dégradé (pdf-parse absent du monorepo)', () => {
  it('bascule en mode degraded avec avertissement documenté', async () => {
    const buffer = Buffer.from('%PDF-1.4 Contenu de cours visible dans le flux', 'utf8');
    const result = await extractPdf(buffer);
    expect(result.mode).toBe('degraded');
    expect(result.warning).toMatch(/pdf-parse/);
    expect(result.text).toContain('Contenu de cours visible dans le flux');
  });
});

describe('extractPptx — repli dégradé (jszip absent du monorepo)', () => {
  it('bascule en mode degraded avec avertissement documenté', async () => {
    const buffer = Buffer.from('PK Contenu de presentation visible', 'utf8');
    const result = await extractPptx(buffer);
    expect(result.mode).toBe('degraded');
    expect(result.warning).toMatch(/jszip/);
    expect(result.text).toContain('Contenu de presentation visible');
  });
});

describe('extractSourceMaterialText — dispatch par type', () => {
  it('route vers extractMarkdown pour kind=markdown', async () => {
    const result = await extractSourceMaterialText(Buffer.from('# Notes', 'utf8'), 'markdown');
    expect(result.mode).toBe('full');
    expect(result.text).toBe('# Notes');
  });

  it('route vers un repli dégradé pour kind=pdf', async () => {
    const result = await extractSourceMaterialText(Buffer.from('texte de test pdf', 'utf8'), 'pdf');
    expect(result.mode).toBe('degraded');
  });

  it('route vers un repli dégradé pour kind=pptx', async () => {
    const result = await extractSourceMaterialText(Buffer.from('texte de test pptx', 'utf8'), 'pptx');
    expect(result.mode).toBe('degraded');
  });
});
