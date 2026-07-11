import { describe, expect, it } from 'vitest';
import {
  diffLines,
  resolveRestoreTarget,
  shouldSnapshotBeforeSave,
  sortVersionsDesc,
} from './version-history';

describe('diffLines', () => {
  it("renvoie toutes les lignes en 'equal' si les textes sont identiques", () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result.every((line) => line.op === 'equal')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('détecte une ligne ajoutée', () => {
    const result = diffLines('a\nb', 'a\nb\nc');
    expect(result).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
  });

  it('détecte une ligne supprimée', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    expect(result).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('détecte un remplacement (suppression + ajout)', () => {
    const result = diffLines('titre initial', 'titre modifié');
    expect(result).toEqual([
      { op: 'remove', text: 'titre initial' },
      { op: 'add', text: 'titre modifié' },
    ]);
  });

  it('gère un texte vide des deux côtés', () => {
    expect(diffLines('', '')).toEqual([{ op: 'equal', text: '' }]);
  });
});

describe('shouldSnapshotBeforeSave', () => {
  it('false si aucun contenu précédent (première sauvegarde)', () => {
    expect(shouldSnapshotBeforeSave(undefined, 'nouveau contenu')).toBe(false);
    expect(shouldSnapshotBeforeSave(null, 'nouveau contenu')).toBe(false);
  });

  it('false si le contenu est identique (rien à verser en historique)', () => {
    expect(shouldSnapshotBeforeSave('même contenu', 'même contenu')).toBe(false);
    expect(shouldSnapshotBeforeSave({ script: [1, 2] }, { script: [1, 2] })).toBe(false);
  });

  it('true si le contenu a changé', () => {
    expect(shouldSnapshotBeforeSave('ancien', 'nouveau')).toBe(true);
    expect(shouldSnapshotBeforeSave({ script: [1] }, { script: [1, 2] })).toBe(true);
  });
});

describe('resolveRestoreTarget', () => {
  const versions = [
    { id: 'v1', snapshot: { articleMd: 'contenu v1' } },
    { id: 'v2', snapshot: { articleMd: 'contenu v2' } },
  ];

  it('retourne le snapshot de la version demandée', () => {
    expect(resolveRestoreTarget(versions, 'v2')).toEqual({ articleMd: 'contenu v2' });
  });

  it('retourne null si la version est introuvable', () => {
    expect(resolveRestoreTarget(versions, 'inconnue')).toBeNull();
  });
});

describe('sortVersionsDesc', () => {
  it('trie du plus récent au plus ancien', () => {
    const versions = [
      { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'new', createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 'mid', createdAt: '2026-03-01T00:00:00.000Z' },
    ];
    expect(sortVersionsDesc(versions).map((v) => v.id)).toEqual(['new', 'mid', 'old']);
  });

  it("ne mute pas le tableau d'origine", () => {
    const versions = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
    ];
    const original = [...versions];
    sortVersionsDesc(versions);
    expect(versions).toEqual(original);
  });
});
