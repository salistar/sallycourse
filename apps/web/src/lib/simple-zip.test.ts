import { describe, expect, it } from 'vitest';
import { buildZip, type ZipEntry } from './simple-zip';

/**
 * Décodeur minimal (méthode "store" uniquement) — relit les local file
 * headers dans l'ordre pour vérifier le round-trip sans dépendance externe.
 */
function readStoredEntries(zip: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset < zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // fin des local file headers
    const method = zip.readUInt16LE(offset + 8);
    expect(method).toBe(0); // store uniquement
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    out.push({ name, data: Buffer.from(data) });
    offset = dataStart + compressedSize;
  }
  return out;
}

describe('simple-zip', () => {
  it('produit une archive vide valide (EOCD seul)', () => {
    const zip = buildZip([]);
    // Signature EOCD en fin d'archive.
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(readStoredEntries(zip)).toEqual([]);
  });

  it('round-trip texte et binaire, plusieurs entrées', () => {
    const entries: ZipEntry[] = [
      { name: 'profil.json', data: JSON.stringify({ email: 'a@b.com' }) },
      { name: 'cours/abc123.json', data: JSON.stringify({ title: 'Cours été' }) },
      { name: 'binaire.bin', data: Buffer.from([0, 1, 2, 255, 254]) },
    ];
    const zip = buildZip(entries);
    const decoded = readStoredEntries(zip);

    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.name).toBe('profil.json');
    expect(JSON.parse(decoded[0]!.data.toString('utf8'))).toEqual({ email: 'a@b.com' });
    expect(decoded[1]!.name).toBe('cours/abc123.json');
    expect(decoded[2]!.data).toEqual(Buffer.from([0, 1, 2, 255, 254]));
  });

  it('gère les caractères accentués dans le contenu (UTF-8)', () => {
    const zip = buildZip([{ name: 'résumé.json', data: 'Généré par IA — été' }]);
    const [entry] = readStoredEntries(zip);
    expect(entry!.data.toString('utf8')).toBe('Généré par IA — été');
  });

  it('place le central directory après toutes les entrées locales', () => {
    const zip = buildZip([{ name: 'a.json', data: '{}' }]);
    const centralDirOffset = zip.readUInt32LE(zip.length - 6);
    const centralDirSize = zip.readUInt32LE(zip.length - 10);
    expect(centralDirOffset + centralDirSize + 22).toBe(zip.length);
    expect(zip.readUInt32LE(centralDirOffset)).toBe(0x02014b50); // signature central dir
  });
});
