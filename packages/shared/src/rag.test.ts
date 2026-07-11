// Tests de la logique PURE d'import de contenu existant (Prompt 90, RAG simple) :
// chunking déterministe, sélection de contexte, détection de type de fichier.
import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_SIZE_CHARS,
  MAX_CONTEXT_CHUNKS,
  buildSourceMaterialContext,
  chunkText,
  detectSourceMaterialKind,
  selectContextChunks,
  sourceMaterialFileSchema,
  sourceMaterialFilesSchema,
} from './rag';

describe('chunkText', () => {
  it('retourne un tableau vide pour un texte vide ou blanc', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('retourne un unique chunk (trimé) pour un texte plus court que la taille cible', () => {
    const text = '  Un court extrait de cours.  ';
    expect(chunkText(text)).toEqual(['Un court extrait de cours.']);
  });

  it('découpe un long texte en plusieurs chunks avec chevauchement', () => {
    const text = 'a'.repeat(5000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Chaque chunk (sauf peut-être le dernier) ne dépasse pas la taille cible.
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE_CHARS);
    }
    // Le dernier caractère du texte source doit être couvert par le dernier chunk.
    expect(chunks[chunks.length - 1]?.endsWith('a')).toBe(true);
  });

  it('couvre l’intégralité du texte source sans trou (chevauchement garanti)', () => {
    // Texte à positions uniques (encodage base36 de l'index) pour retrouver
    // sans ambiguïté la position exacte de chaque chunk dans le texte source.
    const text = Array.from({ length: 1000 }, (_, i) => i.toString(36).padStart(4, '0')).join('');
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 100 });
    const covered = new Set<number>();
    let searchFrom = 0;
    for (const chunk of chunks) {
      const idx = text.indexOf(chunk, searchFrom);
      expect(idx).toBeGreaterThanOrEqual(0);
      for (let i = idx; i < idx + chunk.length; i++) covered.add(i);
      // Le chunk suivant démarre au plus tôt à (start + step) — on autorise
      // simplement de re-chercher depuis un peu avant la fin du chunk courant.
      searchFrom = Math.max(0, idx - CHUNK_OVERLAP_CHARS);
    }
    expect(covered.size).toBe(text.length);
  });

  it('respecte une taille et un chevauchement personnalisés', () => {
    const text = 'x'.repeat(1000);
    const chunks = chunkText(text, { chunkSize: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
  });
});

describe('selectContextChunks / buildSourceMaterialContext', () => {
  it('borne le nombre de chunks sélectionnés à MAX_CONTEXT_CHUNKS par défaut', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => `chunk-${i}`);
    const selected = selectContextChunks(chunks);
    expect(selected).toHaveLength(MAX_CONTEXT_CHUNKS);
    expect(selected).toEqual(chunks.slice(0, MAX_CONTEXT_CHUNKS));
  });

  it('assemble un contexte vide si aucun chunk', () => {
    expect(buildSourceMaterialContext([])).toBe('');
  });

  it('numérote les extraits assemblés dans le contexte', () => {
    const context = buildSourceMaterialContext(['premier extrait', 'second extrait']);
    expect(context).toContain('[Extrait 1/2]');
    expect(context).toContain('[Extrait 2/2]');
    expect(context).toContain('premier extrait');
    expect(context).toContain('second extrait');
  });
});

describe('detectSourceMaterialKind', () => {
  it('reconnaît un PDF par extension ou MIME', () => {
    expect(detectSourceMaterialKind('cours.pdf')).toBe('pdf');
    expect(detectSourceMaterialKind('fichier', 'application/pdf')).toBe('pdf');
  });

  it('reconnaît un PPTX par extension ou MIME', () => {
    expect(detectSourceMaterialKind('slides.pptx')).toBe('pptx');
    expect(
      detectSourceMaterialKind(
        'fichier',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('pptx');
  });

  it('reconnaît un Markdown par extension ou MIME', () => {
    expect(detectSourceMaterialKind('notes.md')).toBe('markdown');
    expect(detectSourceMaterialKind('notes.markdown')).toBe('markdown');
    expect(detectSourceMaterialKind('fichier', 'text/markdown')).toBe('markdown');
  });

  it('retourne null pour un type non supporté', () => {
    expect(detectSourceMaterialKind('image.png', 'image/png')).toBeNull();
  });
});

describe('sourceMaterialFileSchema / sourceMaterialFilesSchema', () => {
  it('valide un descripteur de fichier bien formé', () => {
    const result = sourceMaterialFileSchema.safeParse({
      key: 'courses/abc/source-material/notes.md',
      fileName: 'notes.md',
      kind: 'markdown',
      size: 1234,
      uploadedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejette plus de 10 fichiers', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      key: `k${i}`,
      fileName: `f${i}.md`,
      kind: 'markdown' as const,
      size: 1,
      uploadedAt: new Date().toISOString(),
    }));
    const result = sourceMaterialFilesSchema.safeParse(files);
    expect(result.success).toBe(false);
  });
});
