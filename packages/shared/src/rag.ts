// Import de contenu existant — RAG simple (Prompt 90).
// Schéma des supports source uploadés par l'utilisateur (PDF/PPTX/Markdown)
// et chunking pur du texte extrait, injecté en contexte du prompt outline.
// Aucune dépendance runtime ici (web + worker) : l'extraction réelle (libs
// externes) vit côté worker dans lib/rag-extract.ts.
import { z } from 'zod';

/** Types de support source acceptés à l'upload. */
export const sourceMaterialKindSchema = z.enum(['pdf', 'pptx', 'markdown']);
export type SourceMaterialKind = z.infer<typeof sourceMaterialKindSchema>;

/** Descripteur d'un fichier source importé (stocké tel quel sur S3). */
export const sourceMaterialFileSchema = z.object({
  /** Clé S3 du fichier source original. */
  key: z.string().min(1),
  /** Nom de fichier d'origine (affichage). */
  fileName: z.string().min(1),
  kind: sourceMaterialKindSchema,
  /** Taille en octets (informatif). */
  size: z.number().int().nonnegative(),
  uploadedAt: z.string(),
});
export type SourceMaterialFile = z.infer<typeof sourceMaterialFileSchema>;

export const sourceMaterialFilesSchema = z.array(sourceMaterialFileSchema).max(10);

/** Déduit le type de support depuis le nom de fichier / MIME. */
export function detectSourceMaterialKind(
  fileName: string,
  mimeType?: string,
): SourceMaterialKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (
    lower.endsWith('.pptx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'pptx';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || mimeType === 'text/markdown') {
    return 'markdown';
  }
  return null;
}

/** Taille cible d'un chunk (caractères) — équilibre contexte utile / coût tokens. */
export const CHUNK_SIZE_CHARS = 2000;
/** Chevauchement entre deux chunks consécutifs — évite de couper une idée en deux. */
export const CHUNK_OVERLAP_CHARS = 200;

/**
 * Découpe un texte en chunks de taille ~CHUNK_SIZE_CHARS avec chevauchement.
 * Pure, déterministe, sans dépendance — testable directement. Un texte plus
 * court que CHUNK_SIZE_CHARS retourne un unique chunk (non vide, trim).
 */
export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE_CHARS;
  const overlap = options.overlap ?? CHUNK_OVERLAP_CHARS;
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length === 0) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= clean.length) break;
    start += step;
  }
  return chunks;
}

/** Nombre de chunks à injecter dans le prompt outline — borne le coût tokens. */
export const MAX_CONTEXT_CHUNKS = 6;

/**
 * Sélectionne les chunks les plus pertinents à injecter en contexte. Version
 * simple (P90) : les N premiers chunks (introduction + plan général portent
 * en général l'essentiel du contenu structurant d'un support de cours/livre
 * blanc). Une pondération par mots-clés pourra affiner ce choix plus tard.
 */
export function selectContextChunks(chunks: string[], max = MAX_CONTEXT_CHUNKS): string[] {
  return chunks.slice(0, max);
}

/** Assemble le bloc de contexte à injecter dans le prompt système outline. */
export function buildSourceMaterialContext(chunks: string[]): string {
  const selected = selectContextChunks(chunks);
  if (selected.length === 0) return '';
  return selected
    .map((chunk, index) => `[Extrait ${index + 1}/${selected.length}]\n${chunk}`)
    .join('\n\n');
}
