// Lecteur ZIP minimal, sans dépendance externe (Prompt 182 — re-import de
// l'archive maître). Le web n'a pas de bibliothèque de décompression ; ce
// module lit un ZIP produit par `archiver` (méthodes « store » 0 et
// « deflate » 8) via le seul module natif `zlib`. Pendant de simple-zip.ts.
//
// Lecture guidée par le CENTRAL DIRECTORY (autoritaire) et non par les en-têtes
// locaux : `archiver` streame avec un « data descriptor » (bit 3), laissant les
// tailles à 0 dans l'en-tête local. On lit donc les tailles compressée/
// décompressée depuis le central directory, et on localise les octets de
// données via les longueurs nom/extra de l'en-tête LOCAL (fiables).
//
// Limite connue : format ZIP standard uniquement (pas de ZIP64). Suffisant pour
// les archives de cours courantes ; les très gros exports (>4 Go ou >65535
// entrées) ne sont pas couverts.

import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;

// Bornes anti « zip-bomb » (décompression non bornée). Une entrée deflate peut
// gonfler énormément à partir de quelques octets compressés ; on borne la sortie
// PAR ENTRÉE (au plus la taille déclarée, plafonnée en dur) et le CUMUL de toute
// l'archive, pour ne jamais garder en mémoire au-delà de ces limites.
/** Plafond dur de décompression par entrée (200 Mo). */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
/** Plafond dur cumulé sur toute l'archive (1 Go). */
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/** Erreur de lecture d'un ZIP (signature/tronqué/méthode non supportée). */
export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipReadError';
  }
}

/** Localise l'End Of Central Directory record en repartant de la fin du buffer. */
function findEndOfCentralDirectory(buf: Buffer): number {
  // Le commentaire d'archive peut suivre l'EOCD (jusqu'à 65535 octets).
  const minStart = Math.max(0, buf.length - EOCD_MIN_SIZE - 0xffff);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new ZipReadError('archive ZIP invalide : fin de central directory introuvable');
}

/** Une entrée lue depuis le central directory. */
interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  /** Taille NON compressée déclarée (autoritaire, central directory) — borne la décompression. */
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Lit toutes les entrées d'un ZIP en mémoire. Retourne une Map nom → contenu
 * (Buffer décompressé). Les dossiers (nom se terminant par « / ») sont ignorés.
 */
export function readZipEntries(zip: Buffer): Map<string, Buffer> {
  if (zip.length < EOCD_MIN_SIZE) {
    throw new ZipReadError('archive ZIP invalide : trop petite');
  }

  const eocd = findEndOfCentralDirectory(zip);
  const totalEntries = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16); // offset du central directory

  const central: CentralEntry[] = [];
  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > zip.length || zip.readUInt32LE(ptr) !== CENTRAL_SIGNATURE) {
      throw new ZipReadError('archive ZIP invalide : en-tête central corrompu');
    }
    const method = zip.readUInt16LE(ptr + 10);
    const compressedSize = zip.readUInt32LE(ptr + 20);
    const uncompressedSize = zip.readUInt32LE(ptr + 24);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localHeaderOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    central.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const entry of central) {
    if (entry.name.endsWith('/')) continue; // dossier

    const lh = entry.localHeaderOffset;
    if (lh + 30 > zip.length || zip.readUInt32LE(lh) !== LOCAL_SIGNATURE) {
      throw new ZipReadError(`archive ZIP invalide : en-tête local corrompu (${entry.name})`);
    }
    // Longueurs nom/extra de l'en-tête LOCAL (peuvent différer du central).
    const localNameLen = zip.readUInt16LE(lh + 26);
    const localExtraLen = zip.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > zip.length) {
      throw new ZipReadError(`archive ZIP tronquée : données manquantes (${entry.name})`);
    }
    const compressed = zip.subarray(dataStart, dataEnd);

    let content: Buffer;
    if (entry.method === 0) {
      // « store » : la taille non compressée = la taille des données ; borne dure.
      if (compressed.length > MAX_ENTRY_BYTES) {
        throw new ZipReadError(`entrée trop volumineuse (> ${MAX_ENTRY_BYTES} o) : ${entry.name}`);
      }
      content = Buffer.from(compressed);
    } else if (entry.method === 8) {
      // Borne la sortie à la taille déclarée (autoritaire), plafonnée en dur :
      // au-delà, inflateRawSync jette (RangeError) au lieu de gonfler la mémoire.
      const declared = entry.uncompressedSize > 0 ? entry.uncompressedSize : MAX_ENTRY_BYTES;
      const maxOutputLength = Math.min(declared, MAX_ENTRY_BYTES);
      try {
        content = inflateRawSync(compressed, { maxOutputLength });
      } catch {
        throw new ZipReadError(`décompression impossible ou trop volumineuse (${entry.name})`);
      }
    } else {
      throw new ZipReadError(`méthode de compression non supportée (${entry.method}) : ${entry.name}`);
    }

    totalBytes += content.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ZipReadError(
        `archive ZIP trop volumineuse : décompression cumulée > ${MAX_TOTAL_BYTES} o`,
      );
    }
    out.set(entry.name, content);
  }

  return out;
}
