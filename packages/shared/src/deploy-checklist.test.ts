import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPLOY_CHECKLIST,
  DEPLOY_CHECKLIST_BY_PLATFORM,
  canPublishManually,
  checklistDefForPlatform,
  initManualChecklist,
  isValidHttpUrl,
  mergeChecklistDone,
  type DeployChecklistItem,
} from './deploy-checklist';

describe('checklistDefForPlatform', () => {
  it('retourne les items dédiés d’une plateforme connue', () => {
    expect(checklistDefForPlatform('udemy')).toBe(DEPLOY_CHECKLIST_BY_PLATFORM.udemy);
    expect(checklistDefForPlatform('youtube').some((i) => i.key === 'playlist')).toBe(true);
  });

  it('retombe sur la checklist générique pour une plateforme inconnue', () => {
    expect(checklistDefForPlatform('inconnue')).toBe(DEFAULT_DEPLOY_CHECKLIST);
  });
});

describe('initManualChecklist', () => {
  it('initialise toutes les cases à décoché', () => {
    const list = initManualChecklist('udemy');
    expect(list.length).toBe(DEPLOY_CHECKLIST_BY_PLATFORM.udemy!.length);
    expect(list.every((i) => i.done === false)).toBe(true);
    expect(list[0]).toMatchObject({ key: 'curriculum', done: false });
  });

  it('produit une copie indépendante à chaque appel', () => {
    const a = initManualChecklist('gumroad');
    a[0]!.done = true;
    const b = initManualChecklist('gumroad');
    expect(b[0]!.done).toBe(false);
  });
});

describe('isValidHttpUrl', () => {
  it('accepte http et https', () => {
    expect(isValidHttpUrl('https://www.udemy.com/course/abc')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
    expect(isValidHttpUrl('  https://example.com/x  ')).toBe(true);
  });

  it('rejette les URL vides, non-http ou malformées', () => {
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('example.com')).toBe(false);
  });
});

describe('mergeChecklistDone', () => {
  const base: DeployChecklistItem[] = [
    { key: 'a', label: 'A', done: false },
    { key: 'b', label: 'B', done: true },
  ];

  it('renvoie une copie inchangée sans mise à jour', () => {
    const out = mergeChecklistDone(base, undefined);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it('applique les états done par clé sans toucher aux libellés', () => {
    const out = mergeChecklistDone(base, [
      { key: 'a', done: true },
      { key: 'b', done: false },
    ]);
    expect(out).toEqual([
      { key: 'a', label: 'A', done: true },
      { key: 'b', label: 'B', done: false },
    ]);
  });

  it('ignore les clés inconnues du client et ne fait pas confiance aux libellés', () => {
    const out = mergeChecklistDone(base, [
      { key: 'a', done: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { key: 'evil', done: true, label: 'INJECT' } as any,
    ]);
    expect(out.map((i) => i.key)).toEqual(['a', 'b']);
    expect(out.find((i) => i.key === 'a')!.label).toBe('A');
  });

  it('conserve l’état d’un item de base absent des mises à jour', () => {
    const out = mergeChecklistDone(base, [{ key: 'a', done: true }]);
    expect(out.find((i) => i.key === 'b')!.done).toBe(true);
  });
});

describe('canPublishManually', () => {
  const url = 'https://www.udemy.com/course/abc';

  it('vrai si toutes cochées ET URL valide', () => {
    const list: DeployChecklistItem[] = [
      { key: 'a', label: 'A', done: true },
      { key: 'b', label: 'B', done: true },
    ];
    expect(canPublishManually(list, url)).toBe(true);
  });

  it('faux si une case reste décochée', () => {
    const list: DeployChecklistItem[] = [
      { key: 'a', label: 'A', done: true },
      { key: 'b', label: 'B', done: false },
    ];
    expect(canPublishManually(list, url)).toBe(false);
  });

  it('faux si URL absente ou invalide', () => {
    const list: DeployChecklistItem[] = [{ key: 'a', label: 'A', done: true }];
    expect(canPublishManually(list, undefined)).toBe(false);
    expect(canPublishManually(list, 'pas-une-url')).toBe(false);
  });

  it('faux si checklist vide ou absente', () => {
    expect(canPublishManually([], url)).toBe(false);
    expect(canPublishManually(undefined, url)).toBe(false);
  });
});
