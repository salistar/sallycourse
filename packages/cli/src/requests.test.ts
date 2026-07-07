import { describe, expect, it } from 'vitest';
import {
  buildCreateCourseBody,
  buildDeployBody,
  parseBatchFile,
} from './requests.js';

describe('buildCreateCourseBody', () => {
  it('construit un corps valide avec défauts fr/beginner', () => {
    const body = buildCreateCourseBody({ title: 'Docker pour DevOps' });
    expect(body).toEqual({
      title: 'Docker pour DevOps',
      difficulty: 'beginner',
      locale: 'fr',
      targetPlatforms: [],
    });
  });

  it('mappe level/lang/deploy/sections', () => {
    const body = buildCreateCourseBody({
      title: 'Kubernetes avancé',
      level: 'advanced',
      lang: 'en',
      deploy: ['udemy', 'youtube'],
      sections: 8,
    });
    expect(body.difficulty).toBe('advanced');
    expect(body.locale).toBe('en');
    expect(body.targetPlatforms).toEqual(['udemy', 'youtube']);
    expect(body.approxSections).toBe(8);
  });

  it('rejette un niveau inconnu', () => {
    expect(() => buildCreateCourseBody({ title: 'Titre ok', level: 'expert' })).toThrow(
      /invalides/i,
    );
  });

  it('rejette un titre trop court', () => {
    expect(() => buildCreateCourseBody({ title: 'ab' })).toThrow(/court/i);
  });

  it('rejette sections hors bornes', () => {
    expect(() => buildCreateCourseBody({ title: 'Titre ok', sections: 99 })).toThrow();
  });
});

describe('buildDeployBody', () => {
  it('déduplique et applique mode auto par défaut', () => {
    const body = buildDeployBody(['udemy', 'udemy', 'youtube']);
    expect(body.platforms).toEqual(['udemy', 'youtube']);
    expect(body.mode).toBe('auto');
  });

  it('accepte un mode explicite', () => {
    expect(buildDeployBody(['udemy'], 'manual').mode).toBe('manual');
  });

  it('rejette une liste vide', () => {
    expect(() => buildDeployBody([])).toThrow(/plateforme/i);
  });

  it('rejette un mode inconnu', () => {
    expect(() => buildDeployBody(['udemy'], 'turbo')).toThrow();
  });
});

describe('parseBatchFile', () => {
  it('lit un titre par ligne en ignorant vides et commentaires', () => {
    const content = ['# commentaire', '', 'Docker pour DevOps', 'Git de zéro à héros'].join('\n');
    const entries = parseBatchFile(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.title).toBe('Docker pour DevOps');
  });

  it('parse les surcharges par ligne', () => {
    const content = 'Kubernetes | level=advanced | deploy=udemy,youtube | sections=10';
    const [entry] = parseBatchFile(content);
    expect(entry!.title).toBe('Kubernetes');
    expect(entry!.level).toBe('advanced');
    expect(entry!.deploy).toEqual(['udemy', 'youtube']);
    expect(entry!.sections).toBe(10);
  });

  it('gère les fins de ligne Windows', () => {
    const entries = parseBatchFile('Cours A\r\nCours B\r\n');
    expect(entries.map((e) => e.title)).toEqual(['Cours A', 'Cours B']);
  });
});
