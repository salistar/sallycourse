// Tests de la logique de sauvegarde Mongo (P74) : nommage horodaté +
// politique de rétention (30 jours). Fonctions pures — aucune I/O, aucun
// mock de fichier/S3 nécessaire (voir src/lib/backup-retention.ts).
import { describe, expect, it } from 'vitest';
import {
  applyRetentionPolicy,
  backupNamePattern,
  DEFAULT_RETENTION_DAYS,
  formatBackupName,
  parseBackupDate,
} from './backup-retention.js';

describe('formatBackupName — nommage horodaté', () => {
  it('formate une date UTC en sallycourse-mongo-AAAAMMJJ-HHmmss', () => {
    const date = new Date(Date.UTC(2026, 6, 11, 3, 5, 9)); // 11 juillet 2026, 03:05:09 UTC
    expect(formatBackupName(date)).toBe('sallycourse-mongo-20260711-030509');
  });

  it('pad correctement les valeurs à un seul chiffre (mois/jour/heure/minute/seconde)', () => {
    const date = new Date(Date.UTC(2026, 0, 2, 1, 2, 3)); // 2 janvier 2026, 01:02:03 UTC
    expect(formatBackupName(date)).toBe('sallycourse-mongo-20260102-010203');
  });

  it('accepte un préfixe personnalisé', () => {
    const date = new Date(Date.UTC(2026, 6, 11, 0, 0, 0));
    expect(formatBackupName(date, 'custom-prefix')).toBe('custom-prefix-20260711-000000');
  });

  it('deux dates croissantes produisent des noms triables lexicographiquement dans le même ordre', () => {
    const earlier = formatBackupName(new Date(Date.UTC(2026, 5, 1, 0, 0, 0)));
    const later = formatBackupName(new Date(Date.UTC(2026, 6, 1, 0, 0, 0)));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe('parseBackupDate / backupNamePattern — lecture inverse du nom', () => {
  it('retrouve exactement la date encodée par formatBackupName (round-trip)', () => {
    const original = new Date(Date.UTC(2026, 6, 11, 3, 5, 9));
    const name = formatBackupName(original);
    const parsed = parseBackupDate(name);
    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(original.getTime());
  });

  it('retourne null pour un nom qui ne correspond pas au motif attendu', () => {
    expect(parseBackupDate('un-fichier-quelconque.txt')).toBeNull();
    expect(parseBackupDate('sallycourse-mongo-2026-07-11')).toBeNull();
    expect(parseBackupDate('')).toBeNull();
  });

  it('backupNamePattern matche uniquement les noms bien formés avec le bon préfixe', () => {
    const pattern = backupNamePattern();
    expect(pattern.test('sallycourse-mongo-20260711-030509')).toBe(true);
    expect(pattern.test('autre-prefix-20260711-030509')).toBe(false);
  });

  it('échappe correctement un préfixe contenant des caractères spéciaux regex', () => {
    const prefix = 'mongo.backup+v2';
    const name = formatBackupName(new Date(Date.UTC(2026, 6, 11, 0, 0, 0)), prefix);
    expect(parseBackupDate(name, prefix)?.toISOString()).toBe('2026-07-11T00:00:00.000Z');
    // Ne matche pas un nom d'un autre préfixe même si le pattern contenait des méta-caractères.
    expect(parseBackupDate('mongoXbackupXv2-20260711-000000', prefix)).toBeNull();
  });
});

describe('applyRetentionPolicy — suppression des backups > 30 jours', () => {
  const NOW = new Date(Date.UTC(2026, 6, 11, 12, 0, 0)); // 11 juillet 2026, midi UTC

  it('conserve un backup plus récent que la limite de rétention', () => {
    const recent = { name: formatBackupName(new Date(Date.UTC(2026, 6, 10, 0, 0, 0))) }; // -1 jour
    const { keep, remove } = applyRetentionPolicy([recent], NOW);
    expect(keep).toEqual([recent]);
    expect(remove).toEqual([]);
  });

  it('supprime un backup strictement plus vieux que 30 jours', () => {
    const old = { name: formatBackupName(new Date(Date.UTC(2026, 5, 1, 0, 0, 0))) }; // ~40 jours avant
    const { keep, remove } = applyRetentionPolicy([old], NOW);
    expect(remove).toEqual([old]);
    expect(keep).toEqual([]);
  });

  it('conserve un backup exactement à la limite (30 jours - 1s) et supprime celui juste après la limite', () => {
    const cutoffMs = NOW.getTime() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const justInside = { name: formatBackupName(new Date(cutoffMs + 1000)) }; // 1s après la limite → conservé
    const justOutside = { name: formatBackupName(new Date(cutoffMs - 1000)) }; // 1s avant la limite → supprimé

    const { keep, remove } = applyRetentionPolicy([justInside, justOutside], NOW);
    expect(keep).toEqual([justInside]);
    expect(remove).toEqual([justOutside]);
  });

  it('trie un mélange de backups récents/anciens/invalides dans les bons groupes', () => {
    const recent1 = { name: formatBackupName(new Date(Date.UTC(2026, 6, 9, 0, 0, 0))) };
    const recent2 = { name: formatBackupName(new Date(Date.UTC(2026, 6, 5, 0, 0, 0))) };
    const old1 = { name: formatBackupName(new Date(Date.UTC(2026, 4, 1, 0, 0, 0))) };
    const old2 = { name: formatBackupName(new Date(Date.UTC(2026, 3, 15, 0, 0, 0))) };
    const junk = { name: 'README.md' };

    const { keep, remove, unparsable } = applyRetentionPolicy(
      [recent1, recent2, old1, old2, junk],
      NOW,
    );

    expect(keep).toEqual([recent1, recent2]);
    expect(remove).toEqual([old1, old2]);
    expect(unparsable).toEqual([junk]);
  });

  it('ne supprime jamais une entrée dont le nom est illisible (unparsable), même très ancien', () => {
    const junk = { name: 'backup-mysterieux-sans-date' };
    const { keep, remove, unparsable } = applyRetentionPolicy([junk], NOW);
    expect(remove).toEqual([]);
    expect(keep).toEqual([]);
    expect(unparsable).toEqual([junk]);
  });

  it('respecte une rétention personnalisée (ex. 7 jours)', () => {
    const eightDaysAgo = { name: formatBackupName(new Date(Date.UTC(2026, 6, 3, 0, 0, 0))) };
    const sixDaysAgo = { name: formatBackupName(new Date(Date.UTC(2026, 6, 5, 0, 0, 0))) };

    const { keep, remove } = applyRetentionPolicy([eightDaysAgo, sixDaysAgo], NOW, 7);
    expect(keep).toEqual([sixDaysAgo]);
    expect(remove).toEqual([eightDaysAgo]);
  });

  it('liste vide → aucun groupe non vide', () => {
    const { keep, remove, unparsable } = applyRetentionPolicy([], NOW);
    expect(keep).toEqual([]);
    expect(remove).toEqual([]);
    expect(unparsable).toEqual([]);
  });
});
