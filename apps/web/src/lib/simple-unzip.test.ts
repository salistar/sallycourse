import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { buildZip } from './simple-zip';
import { readZipEntries, ZipReadError } from './simple-unzip';

describe('readZipEntries — méthode « store » (round-trip avec buildZip)', () => {
  it('relit exactement les entrées écrites par buildZip', () => {
    const entries = [
      { name: 'manifest.json', data: JSON.stringify({ version: 1 }) },
      { name: 'media/video.bin', data: Buffer.from([0, 1, 2, 3, 255, 254]) },
      { name: 'README.md', data: '# Titre\n\nContenu accentué : é à ü.' },
    ];
    const zip = buildZip(entries);
    const read = readZipEntries(zip);

    expect(read.size).toBe(3);
    expect(read.get('manifest.json')!.toString('utf8')).toBe('{"version":1}');
    expect(Array.from(read.get('media/video.bin')!)).toEqual([0, 1, 2, 3, 255, 254]);
    expect(read.get('README.md')!.toString('utf8')).toContain('accentué');
  });

  it('ignore les entrées « dossier » (nom terminé par /)', () => {
    const zip = buildZip([
      { name: 'media/', data: '' },
      { name: 'media/a.txt', data: 'a' },
    ]);
    const read = readZipEntries(zip);
    expect(read.has('media/')).toBe(false);
    expect(read.get('media/a.txt')!.toString('utf8')).toBe('a');
  });
});

describe('readZipEntries — méthode « deflate » (data descriptor)', () => {
  it('décompresse une entrée deflate en lisant les tailles du central directory', () => {
    const original = Buffer.from('contenu déflaté répété '.repeat(20), 'utf8');
    const compressed = deflateRawSync(original);
    const name = Buffer.from('lessons.json', 'utf8');

    // En-tête local : flag bit3 (data descriptor), tailles laissées à 0 —
    // exactement ce que produit archiver en streaming.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0008, 6); // flag data descriptor
    local.writeUInt16LE(8, 8); // méthode deflate
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const localBlock = Buffer.concat([local, name, compressed]);

    // Central directory : tailles RÉELLES (autoritaires).
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0008, 8);
    central.writeUInt16LE(8, 10); // méthode deflate
    central.writeUInt32LE(0, 16); // crc (non utilisé par le lecteur)
    central.writeUInt32LE(compressed.length, 20); // compressed size réelle
    central.writeUInt32LE(original.length, 24); // uncompressed size
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42); // offset du local header
    const centralBlock = Buffer.concat([central, name]);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralBlock.length, 12);
    eocd.writeUInt32LE(localBlock.length, 16);

    const zip = Buffer.concat([localBlock, centralBlock, eocd]);
    const read = readZipEntries(zip);
    expect(read.get('lessons.json')!.toString('utf8')).toBe(original.toString('utf8'));
  });
});

describe('readZipEntries — erreurs', () => {
  it('jette sur un buffer qui n\'est pas un ZIP', () => {
    expect(() => readZipEntries(Buffer.from('pas un zip du tout'))).toThrowError(ZipReadError);
  });

  it('jette sur un buffer trop petit', () => {
    expect(() => readZipEntries(Buffer.from([1, 2, 3]))).toThrowError(ZipReadError);
  });
});

describe('readZipEntries — anti zip-bomb (finding 4)', () => {
  it('borne la décompression par entrée (maxOutputLength) : jette si la sortie dépasse la taille déclarée', () => {
    // Entrée deflate dont la taille NON compressée réelle est bien supérieure à
    // celle DÉCLARÉE (5 o) dans le central directory → inflateRawSync doit
    // s'arrêter net (borne maxOutputLength) au lieu de gonfler la mémoire.
    const original = Buffer.from('A'.repeat(5000), 'utf8');
    const compressed = deflateRawSync(original);
    const name = Buffer.from('bomb.bin', 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localBlock = Buffer.concat([local, name, compressed]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt32LE(compressed.length, 20); // compressed size réelle
    central.writeUInt32LE(5, 24); // uncompressed size DÉCLARÉE (mensongère, trop petite)
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const centralBlock = Buffer.concat([central, name]);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralBlock.length, 12);
    eocd.writeUInt32LE(localBlock.length, 16);

    const zip = Buffer.concat([localBlock, centralBlock, eocd]);
    expect(() => readZipEntries(zip)).toThrowError(ZipReadError);
  });
});
