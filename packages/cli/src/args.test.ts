import { describe, expect, it } from 'vitest';
import { parseArgs, optString, optBool, splitCsv } from './args.js';

describe('parseArgs', () => {
  it('sépare positionnels et options --flag value', () => {
    const r = parseArgs(['create', 'Docker', '--level', 'intermediate']);
    expect(r.positionals).toEqual(['create', 'Docker']);
    expect(r.options.level).toBe('intermediate');
  });

  it('gère --flag=value', () => {
    const r = parseArgs(['--lang=fr', '--deploy=udemy,youtube']);
    expect(r.options.lang).toBe('fr');
    expect(r.options.deploy).toBe('udemy,youtube');
  });

  it('traite les flags booléens sans consommer la valeur suivante', () => {
    const r = parseArgs(['create', '--json', 'Titre'], { booleanFlags: ['json'] });
    expect(r.options.json).toBe(true);
    expect(r.positionals).toEqual(['create', 'Titre']);
  });

  it('un --flag final sans valeur devient booléen', () => {
    const r = parseArgs(['status', '665f', '--json']);
    expect(r.options.json).toBe(true);
  });

  it('résout les alias courts', () => {
    const r = parseArgs(['-h'], { booleanFlags: ['help'], aliases: { h: 'help' } });
    expect(r.options.help).toBe(true);
  });

  it('-- force le reste en positionnel', () => {
    const r = parseArgs(['create', '--', '--pas-une-option']);
    expect(r.positionals).toEqual(['create', '--pas-une-option']);
  });
});

describe('optString / optBool / splitCsv', () => {
  it('optString lit la première option présente', () => {
    const r = parseArgs(['--platforms', 'udemy']);
    expect(optString(r, 'platforms', 'deploy')).toBe('udemy');
    expect(optString(r, 'absent')).toBeUndefined();
  });

  it('optBool reconnaît true littéral et flag', () => {
    const r = parseArgs(['--json', '--verbose=true'], { booleanFlags: ['json'] });
    expect(optBool(r, 'json')).toBe(true);
    expect(optBool(r, 'verbose')).toBe(true);
    expect(optBool(r, 'quiet')).toBe(false);
  });

  it('splitCsv nettoie et filtre', () => {
    expect(splitCsv(' udemy , youtube ,,')).toEqual(['udemy', 'youtube']);
    expect(splitCsv(undefined)).toEqual([]);
  });
});
