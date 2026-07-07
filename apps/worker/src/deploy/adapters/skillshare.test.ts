// Tests de la logique PURE de l'adapter Skillshare : projet de classe par
// défaut (sans TP) — chemin déterministe sans appel Claude/navigateur.
import { describe, expect, it } from 'vitest';
import { generateClassProject } from './skillshare.js';

describe('generateClassProject (sans TP)', () => {
  it('produit un projet par défaut dérivé du titre du cours', async () => {
    const project = await generateClassProject({ title: 'Bases du CSS' }, null);
    expect(project.title).toContain('Bases du CSS');
    expect(project.brief).toContain('Bases du CSS');
    expect(project.steps.length).toBeGreaterThanOrEqual(1);
  });
});
