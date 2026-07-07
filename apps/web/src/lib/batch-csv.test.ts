import { describe, it, expect } from 'vitest';
import { parseBatchCsv, splitCsvLine, BATCH_MAX_ROWS } from './batch-csv';

describe('splitCsvLine', () => {
  it('découpe des champs simples', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('respecte les virgules entre guillemets', () => {
    expect(splitCsvLine('"Titre, avec virgule",beginner')).toEqual([
      'Titre, avec virgule',
      'beginner',
    ]);
  });

  it('gère les guillemets échappés ("")', () => {
    expect(splitCsvLine('"Il dit ""bonjour""",fr')).toEqual(['Il dit "bonjour"', 'fr']);
  });

  it('rogne les espaces autour des champs', () => {
    expect(splitCsvLine(' a , b ')).toEqual(['a', 'b']);
  });
});

describe('parseBatchCsv — en-tête et structure', () => {
  it('rejette un fichier vide', () => {
    expect(parseBatchCsv('').fatal).toBe('Fichier vide.');
    expect(parseBatchCsv('   \n  ').fatal).toBe('Fichier vide.');
  });

  it('exige une colonne title', () => {
    const res = parseBatchCsv('level,language\nbeginner,fr');
    expect(res.fatal).toContain('title');
    expect(res.valid).toHaveLength(0);
  });

  it('accepte des en-têtes FR (titre/niveau/langue/plateformes)', () => {
    const res = parseBatchCsv('titre,niveau,langue,plateformes\nMon cours,avancé,en,udemy;youtube');
    expect(res.fatal).toBeUndefined();
    expect(res.valid).toHaveLength(1);
    expect(res.valid[0]!.input).toEqual({
      title: 'Mon cours',
      difficulty: 'advanced',
      locale: 'en',
      targetPlatforms: ['udemy', 'youtube'],
    });
  });

  it("tolère l'ordre libre des colonnes", () => {
    const res = parseBatchCsv('language,title\nen,Docker de zéro');
    expect(res.valid[0]!.input.title).toBe('Docker de zéro');
    expect(res.valid[0]!.input.locale).toBe('en');
  });

  it('refuse au-delà de BATCH_MAX_ROWS lignes', () => {
    const rows = Array.from({ length: BATCH_MAX_ROWS + 1 }, (_, i) => `Cours numéro ${i}`).join('\n');
    const res = parseBatchCsv(`title\n${rows}`);
    expect(res.fatal).toContain('Trop de lignes');
  });
});

describe('parseBatchCsv — valeurs par défaut et validation par ligne', () => {
  it('applique les défauts beginner/fr et plateformes vides', () => {
    const res = parseBatchCsv('title\nApprendre TypeScript');
    expect(res.valid[0]!.input).toEqual({
      title: 'Apprendre TypeScript',
      difficulty: 'beginner',
      locale: 'fr',
      targetPlatforms: [],
    });
  });

  it('rejette un titre trop court', () => {
    const res = parseBatchCsv('title\nAb');
    expect(res.valid).toHaveLength(0);
    expect(res.invalid).toHaveLength(1);
    expect(res.invalid[0]!.line).toBe(1);
    expect(res.invalid[0]!.errors[0]).toContain('trop court');
  });

  it('rejette un niveau invalide', () => {
    const res = parseBatchCsv('title,level\nUn bon cours,expert');
    expect(res.invalid).toHaveLength(1);
    expect(res.invalid[0]!.errors[0]).toContain('Niveau invalide');
  });

  it('rejette une langue non supportée', () => {
    const res = parseBatchCsv('title,language\nUn bon cours,de');
    expect(res.invalid).toHaveLength(1);
  });

  it('sépare les valides et les invalides avec le bon numéro de ligne', () => {
    const csv = ['title,level', 'Cours valide un,beginner', 'X,advanced', 'Cours valide deux,avancé'].join('\n');
    const res = parseBatchCsv(csv);
    expect(res.valid.map((v) => v.line)).toEqual([1, 3]);
    expect(res.invalid.map((v) => v.line)).toEqual([2]);
  });

  it('ignore les lignes blanches intercalées sans décaler la numérotation logique', () => {
    const csv = 'title\nPremier cours ok\n\nDeuxième cours ok';
    const res = parseBatchCsv(csv);
    expect(res.valid).toHaveLength(2);
    expect(res.valid[1]!.input.title).toBe('Deuxième cours ok');
  });

  it('gère CRLF et BOM', () => {
    const csv = '﻿title,level\r\nApprendre Go,intermediate\r\n';
    const res = parseBatchCsv(csv);
    expect(res.valid).toHaveLength(1);
    expect(res.valid[0]!.input.difficulty).toBe('intermediate');
  });

  it('découpe les plateformes sur « ; » et normalise en minuscules', () => {
    const res = parseBatchCsv('title,platforms\nUn cours complet, Udemy ; YouTube ;');
    expect(res.valid[0]!.input.targetPlatforms).toEqual(['udemy', 'youtube']);
  });
});
