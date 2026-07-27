import { describe, expect, it } from 'vitest';
import { renderPlatformConstraints, activePlatformConstraints } from './platform-constraints';

describe('renderPlatformConstraints', () => {
  it('vide sans plateforme ou plateforme inconnue', () => {
    expect(renderPlatformConstraints(undefined)).toBe('');
    expect(renderPlatformConstraints([])).toBe('');
    expect(renderPlatformConstraints(['inconnue'])).toBe('');
  });

  it('injecte les contraintes des plateformes connues', () => {
    const out = renderPlatformConstraints(['udemy', 'youtube']);
    expect(out).toContain('CONTRAINTES DES PLATEFORMES');
    expect(out).toContain('Udemy :');
    expect(out).toContain('30 minutes');
    expect(out).toContain('YouTube :');
    expect(out).toContain('10 minutes');
  });

  it('ignore les plateformes inconnues mais garde les connues', () => {
    const out = renderPlatformConstraints(['skillshare', 'inconnue']);
    expect(out).toContain('Skillshare');
    expect(out).toContain('PROJET');
  });
});

describe('activePlatformConstraints', () => {
  it('retourne les contraintes structurées des plateformes connues', () => {
    const active = activePlatformConstraints(['udemy', 'inconnue', 'coursera']);
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.platform)).toEqual(['udemy', 'coursera']);
    expect(active[0]!.rules.length).toBeGreaterThan(0);
  });
});
