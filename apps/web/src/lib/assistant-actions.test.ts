import { describe, expect, it } from 'vitest';
import {
  executionForAction,
  planForAction,
  resolveAssistantCommand,
} from './assistant-actions';

describe('executionForAction', () => {
  it('mappe chaque action mutante sur sa route métier existante', () => {
    expect(executionForAction({ type: 'create_course', input: { title: 'X', difficulty: 'beginner', locale: 'fr', targetPlatforms: [] } })).toEqual({
      method: 'POST',
      path: '/api/courses',
      body: { title: 'X', difficulty: 'beginner', locale: 'fr', targetPlatforms: [] },
    });
    expect(executionForAction({ type: 'continue_generation', courseId: 'c1' })).toEqual({
      method: 'POST',
      path: '/api/courses/c1/continue-generation',
    });
    expect(executionForAction({ type: 'regenerate_outline', courseId: 'c1', extraInstructions: 'plus de TP' })).toEqual({
      method: 'POST',
      path: '/api/courses/c1/regenerate-outline',
      body: { extraInstructions: 'plus de TP' },
    });
    expect(executionForAction({ type: 'regenerate_lesson', courseId: 'c1', lessonId: 'l1' })).toEqual({
      method: 'POST',
      path: '/api/lessons/l1/regenerate',
      body: { mode: 'full' },
    });
    expect(executionForAction({ type: 'deploy_course', courseId: 'c1', platform: 'udemy' })).toEqual({
      method: 'POST',
      path: '/api/courses/c1/deploy',
      body: { platforms: ['udemy'], mode: 'auto' },
    });
  });

  it('ne mappe aucune exécution pour une action none', () => {
    expect(executionForAction({ type: 'none', reason: 'rien' })).toBeNull();
  });
});

describe('planForAction', () => {
  it('marque les actions mutantes comme nécessitant confirmation', () => {
    const plan = planForAction({ type: 'deploy_course', courseId: 'c1' });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.execution).not.toBeNull();
  });

  it('une action none ne nécessite pas de confirmation et n’a pas d’exécution', () => {
    const plan = planForAction({ type: 'none', reason: 'ambigu' });
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.execution).toBeNull();
    expect(plan.summary).toBe('ambigu');
  });
});

describe('resolveAssistantCommand', () => {
  it('résout une création de cours avec sujet et niveau', () => {
    const plan = resolveAssistantCommand('Crée un cours sur Docker pour débutants');
    expect(plan.action.type).toBe('create_course');
    if (plan.action.type === 'create_course') {
      expect(plan.action.input.title.toLowerCase()).toContain('docker');
      expect(plan.action.input.difficulty).toBe('beginner');
    }
    expect(plan.requiresConfirmation).toBe(true);
  });

  it('détecte un niveau avancé', () => {
    const plan = resolveAssistantCommand('crée un cours sur Kubernetes niveau avancé');
    if (plan.action.type === 'create_course') expect(plan.action.input.difficulty).toBe('advanced');
    else throw new Error('attendu create_course');
  });

  it('demande le sujet quand la création n’en précise pas', () => {
    const plan = resolveAssistantCommand('crée un cours');
    expect(plan.action.type).toBe('none');
  });

  it('exige un cours courant pour un déploiement', () => {
    expect(resolveAssistantCommand('déploie ce cours').action.type).toBe('none');
    const plan = resolveAssistantCommand('déploie sur udemy', { currentCourseId: 'c9' });
    expect(plan.action.type).toBe('deploy_course');
    if (plan.action.type === 'deploy_course') expect(plan.action.platform).toBe('udemy');
  });

  it('résout la régénération du plan sur le cours courant', () => {
    const plan = resolveAssistantCommand('régénère le plan', { currentCourseId: 'c9' });
    expect(plan.action.type).toBe('regenerate_outline');
  });

  it('résout la validation/continuation sur le cours courant', () => {
    const plan = resolveAssistantCommand('valide et continue', { currentCourseId: 'c9' });
    expect(plan.action.type).toBe('continue_generation');
  });

  it('renvoie none avec une aide quand rien n’est compris', () => {
    const plan = resolveAssistantCommand('quelle heure est-il ?');
    expect(plan.action.type).toBe('none');
    expect(plan.execution).toBeNull();
  });

  it('n’exécute jamais : le plan ne fait que décrire la route à appeler', () => {
    const plan = resolveAssistantCommand('déploie sur udemy', { currentCourseId: 'c9' });
    // Le contrat clé : l'assistant PROPOSE (execution décrite) mais n'appelle rien.
    expect(plan.execution?.method).toBe('POST');
    expect(plan.execution?.path).toBe('/api/courses/c9/deploy');
  });

  it('déploiement sans plateforme : demande laquelle plutôt que de proposer une cible ambiguë', () => {
    const plan = resolveAssistantCommand('déploie', { currentCourseId: 'c9' });
    expect(plan.action.type).toBe('none');
    expect(plan.execution).toBeNull();
  });
});
