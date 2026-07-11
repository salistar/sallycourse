// Import de contenu existant — RAG simple (Prompt 90).
// Extraction de texte depuis un support source (PDF/PPTX/Markdown) uploadé
// par l'utilisateur, avant chunking (packages/shared/src/rag.ts) et injection
// en contexte du prompt outline. Les libs d'extraction riches ('pdf-parse',
// 'jszip') sont OPTIONNELLES : si absentes du lockfile, on bascule sur un
// mode dégradé documenté (extraction best-effort) plutôt que d'échouer.
import { logger } from '../queues/index.js';
// @ts-ignore TS6059 — source hors rootDir (voir shared.ts), typage intact
import type { SourceMaterialKind } from '../shared.js';

export interface ExtractResult {
  /** Texte brut extrait (peut être vide si le support n'en contient pas). */
  text: string;
  /** Mode d'extraction effectivement utilisé — 'full' (lib dédiée) ou 'degraded' (repli). */
  mode: 'full' | 'degraded';
  /** Avertissement lisible si mode dégradé (affichable dans les logs de génération). */
  warning?: string;
}

/**
 * Extraction Markdown — lecture directe, aucune dépendance. Toujours en
 * mode 'full' (pas de dégradation possible pour du texte déjà lisible).
 */
export function extractMarkdown(buffer: Buffer): ExtractResult {
  return { text: buffer.toString('utf8'), mode: 'full' };
}

/**
 * Extraction best-effort des chaînes ASCII/latin visibles d'un buffer binaire
 * (PDF ou PPTX sans lib dédiée). Ne décode aucun format — repère simplement
 * les séquences de caractères imprimables suffisamment longues pour être du
 * texte de contenu (heuristique grossière mais sans dépendance). Documenté
 * comme dégradé : ponctuation/mise en page perdues, faux positifs possibles.
 */
export function extractPrintableStringsFallback(buffer: Buffer): string {
  const MIN_RUN_LENGTH = 4;
  const printable = /[\x20-\x7E]/;
  const runs: string[] = [];
  let current = '';
  for (let i = 0; i < buffer.length; i++) {
    const ch = String.fromCharCode(buffer[i] ?? 0);
    if (printable.test(ch)) {
      current += ch;
    } else {
      if (current.length >= MIN_RUN_LENGTH) runs.push(current);
      current = '';
    }
  }
  if (current.length >= MIN_RUN_LENGTH) runs.push(current);
  return runs.join(' ');
}

/**
 * Extraction PDF — utilise 'pdf-parse' si le paquet est installé (depsNeeded,
 * non installé dans ce monorepo au moment du prompt 90). À défaut, repli sur
 * l'extraction best-effort des chaînes visibles (mode 'degraded').
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  try {
    // Import dynamique optionnel : ne casse pas le build si absent du lockfile.
    const mod: unknown = await import('pdf-parse' as string).catch(() => null);
    if (mod && typeof (mod as { default?: unknown }).default === 'function') {
      const pdfParse = (mod as { default: (buf: Buffer) => Promise<{ text: string }> }).default;
      const result = await pdfParse(buffer);
      return { text: result.text ?? '', mode: 'full' };
    }
    if (mod && typeof mod === 'function') {
      const pdfParse = mod as (buf: Buffer) => Promise<{ text: string }>;
      const result = await pdfParse(buffer);
      return { text: result.text ?? '', mode: 'full' };
    }
  } catch (err) {
    logger.warn({ err }, 'rag-extract: pdf-parse indisponible ou en échec — repli dégradé');
  }
  return {
    text: extractPrintableStringsFallback(buffer),
    mode: 'degraded',
    warning:
      "Extraction PDF dégradée ('pdf-parse' absent) : texte approximatif, sans mise en page. Installez 'pdf-parse' pour une extraction complète.",
  };
}

/**
 * Extraction PPTX — un .pptx est une archive ZIP contenant des XML
 * `ppt/slides/slideN.xml` où le texte visible est dans des balises `<a:t>`.
 * Utilise 'jszip' si installé (depsNeeded, absent au moment du prompt 90)
 * pour dézipper puis un parsing basique par regex des `<a:t>…</a:t>`.
 * À défaut, repli sur l'extraction best-effort des chaînes visibles.
 */
export async function extractPptx(buffer: Buffer): Promise<ExtractResult> {
  try {
    // Forme minimale utilisée du zip chargé (lib optionnelle, pas de @types dispo).
    interface MinimalZip {
      files: Record<string, { async: (type: 'string') => Promise<string> }>;
    }
    const mod: unknown = await import('jszip' as string).catch(() => null);
    const JSZip = (mod as { default?: unknown })?.default ?? mod;
    if (JSZip && typeof (JSZip as { loadAsync?: unknown }).loadAsync === 'function') {
      const zip = await (
        JSZip as { loadAsync: (b: Buffer) => Promise<MinimalZip> }
      ).loadAsync(buffer);
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
          const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
          return na - nb;
        });
      const texts: string[] = [];
      for (const name of slideFiles) {
        const entry = zip.files[name];
        if (!entry) continue;
        const xml: string = await entry.async('string');
        texts.push(extractTextTagsFromXml(xml));
      }
      return { text: texts.join('\n\n'), mode: 'full' };
    }
  } catch (err) {
    logger.warn({ err }, 'rag-extract: jszip indisponible ou en échec — repli dégradé');
  }
  return {
    text: extractPrintableStringsFallback(buffer),
    mode: 'degraded',
    warning:
      "Extraction PPTX dégradée ('jszip' absent) : texte brut approximatif, structure des diapositives perdue. Installez 'jszip' pour une extraction complète.",
  };
}

/** Parsing basique du contenu texte des balises `<a:t>…</a:t>` d'un XML de slide PPTX. */
export function extractTextTagsFromXml(xml: string): string {
  const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
  return matches
    .map((tag) => tag.replace(/<a:t>|<\/a:t>/g, ''))
    .map((s) => decodeXmlEntities(s))
    .join(' ');
}

/** Décode les entités XML les plus courantes (évite une dépendance XML complète). */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Dispatch par type de support (miroir de detectSourceMaterialKind côté shared). */
export async function extractSourceMaterialText(
  buffer: Buffer,
  kind: SourceMaterialKind,
): Promise<ExtractResult> {
  switch (kind) {
    case 'markdown':
      return extractMarkdown(buffer);
    case 'pdf':
      return extractPdf(buffer);
    case 'pptx':
      return extractPptx(buffer);
    default:
      return { text: '', mode: 'degraded', warning: `Type de support non reconnu : ${kind}` };
  }
}
