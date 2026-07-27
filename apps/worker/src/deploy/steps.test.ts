// Tests du modèle PUR des étapes du flow de déploiement (Prompt 179) : ordre des
// étapes + annotation done/pending selon le checkpoint (règle conservatrice).
import { describe, expect, it } from 'vitest';
import { buildDeploySteps, remainingSteps } from './steps.js';

describe('buildDeploySteps', () => {
  it('ordonne authenticate → createCourse → upload×N → landing → review', () => {
    const steps = buildDeploySteps(2);
    expect(steps.map((s) => s.key)).toEqual([
      'authenticate',
      'createCourse',
      'upload-0',
      'upload-1',
      'landing',
      'review',
    ]);
    expect(steps.map((s) => s.phase)).toEqual([
      'authenticate',
      'createCourse',
      'upload',
      'upload',
      'landing',
      'review',
    ]);
    expect(steps[2]!.lessonIndex).toBe(0);
    expect(steps[3]!.lessonIndex).toBe(1);
  });

  it('sans leçon : uniquement les 4 étapes hors upload', () => {
    expect(buildDeploySteps(0).map((s) => s.key)).toEqual([
      'authenticate',
      'createCourse',
      'landing',
      'review',
    ]);
  });

  it('borne un total négatif/fractionnaire', () => {
    expect(buildDeploySteps(-3).some((s) => s.phase === 'upload')).toBe(false);
    expect(buildDeploySteps(2.9).filter((s) => s.phase === 'upload')).toHaveLength(2);
  });
});

/** Raccourci : clés des étapes restantes (done=false) pour un checkpoint donné. */
function pendingKeys(total: number, checkpoint: { lessonIndex: number; step: string }): string[] {
  return remainingSteps(total, checkpoint)
    .filter((s) => !s.done)
    .map((s) => s.key);
}

describe('remainingSteps', () => {
  it('checkpoint vide ⇒ toutes les étapes restantes (guide complet, dégradation propre)', () => {
    const annotated = remainingSteps(2, { lessonIndex: 0, step: '' });
    expect(annotated.every((s) => !s.done)).toBe(true);
    expect(pendingKeys(2, { lessonIndex: 0, step: '' })).toEqual([
      'authenticate',
      'createCourse',
      'upload-0',
      'upload-1',
      'landing',
      'review',
    ]);
  });

  it('pause captcha (step=authenticate) ⇒ re-propose l’authentification (conservateur)', () => {
    // Udemy pose step=authenticate AVANT de réussir le login : on ne marque pas
    // authenticate comme fait, la reprise doit re-tenter la connexion.
    expect(pendingKeys(2, { lessonIndex: 0, step: 'authenticate' })).toEqual([
      'authenticate',
      'createCourse',
      'upload-0',
      'upload-1',
      'landing',
      'review',
    ]);
  });

  it('step=createCourse ⇒ authenticate faite, le reste restant', () => {
    const annotated = remainingSteps(2, { lessonIndex: 0, step: 'createCourse' });
    expect(annotated.find((s) => s.key === 'authenticate')!.done).toBe(true);
    expect(annotated.find((s) => s.key === 'createCourse')!.done).toBe(false);
    expect(pendingKeys(2, { lessonIndex: 0, step: 'createCourse' })).toEqual([
      'createCourse',
      'upload-0',
      'upload-1',
      'landing',
      'review',
    ]);
  });

  it('upload partiel (lessonIndex=2) ⇒ 2 leçons faites + auth/create faites', () => {
    const annotated = remainingSteps(4, { lessonIndex: 2, step: 'upload' });
    const done = annotated.filter((s) => s.done).map((s) => s.key);
    expect(done).toEqual(['authenticate', 'createCourse', 'upload-0', 'upload-1']);
    expect(pendingKeys(4, { lessonIndex: 2, step: 'upload' })).toEqual([
      'upload-2',
      'upload-3',
      'landing',
      'review',
    ]);
  });

  it('flow terminé (step=done) ⇒ tout est fait', () => {
    const annotated = remainingSteps(3, { lessonIndex: 3, step: 'done' });
    expect(annotated.every((s) => s.done)).toBe(true);
    expect(pendingKeys(3, { lessonIndex: 3, step: 'done' })).toEqual([]);
  });

  it('borne un lessonIndex aberrant sans dépasser le total', () => {
    // lessonIndex au-delà du total : toutes les leçons faites (pas de crash).
    const done = remainingSteps(2, { lessonIndex: 99, step: 'upload' })
      .filter((s) => s.done)
      .map((s) => s.key);
    expect(done).toEqual(['authenticate', 'createCourse', 'upload-0', 'upload-1']);
  });
});
