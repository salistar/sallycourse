// Tests purs (P206) : génération du kit DMCA (document + checklist). Aucune I/O.
import { describe, expect, it } from 'vitest';
import { buildDmcaKit, type DmcaNoticeInput } from './dmca';

const complete = (overrides: Partial<DmcaNoticeInput> = {}): DmcaNoticeInput => ({
  claimantName: 'Jane Doe',
  claimantEmail: 'jane@example.com',
  courseTitle: 'Kubernetes de A à Z',
  originalUrl: 'https://sallycourse.app/learn/abc',
  infringingUrls: ['https://pirate.example/course-abc', 'https://pirate.example/mirror'],
  recipient: 'DMCA Agent, PirateHost Inc.',
  date: new Date('2026-07-14T00:00:00Z'),
  ...overrides,
});

describe('buildDmcaKit', () => {
  it('produit un document complet quand toutes les infos sont fournies', () => {
    const { document, missing, checklist } = buildDmcaKit(complete());
    expect(document).toContain('Kubernetes de A à Z');
    expect(document).toContain('https://pirate.example/course-abc');
    expect(document).toContain('https://pirate.example/mirror');
    expect(document).toContain('jane@example.com');
    expect(document).toContain('2026-07-14');
    expect(document).toContain('peine de parjure');
    expect(document).not.toContain('[À COMPLÉTER');
    // "Envoi manuel" reste toujours à faire (aucun envoi automatique).
    expect(missing).toEqual(['Envoi manuel']);
    expect(checklist.find((i) => i.id === 'send')?.done).toBe(false);
  });

  it('insère des placeholders et marque les items manquants', () => {
    const { document, missing, checklist } = buildDmcaKit({
      claimantName: '',
      claimantEmail: 'not-an-email',
      courseTitle: '',
      originalUrl: '',
      infringingUrls: [],
    });
    expect(document).toContain('[À COMPLÉTER');
    expect(checklist.find((i) => i.id === 'contact')?.done).toBe(false);
    expect(checklist.find((i) => i.id === 'infringing')?.done).toBe(false);
    expect(missing).toContain('Identité du titulaire des droits');
    expect(missing).toContain('URL(s) du contenu contrefaisant');
    expect(missing).toContain('Coordonnées de contact valides');
  });

  it('filtre les URLs vides et coche la déclaration légale (toujours incluse)', () => {
    const { checklist } = buildDmcaKit(complete({ infringingUrls: ['  ', 'https://x.example/y'] }));
    expect(checklist.find((i) => i.id === 'infringing')?.done).toBe(true);
    expect(checklist.find((i) => i.id === 'good-faith')?.done).toBe(true);
    expect(checklist.find((i) => i.id === 'perjury')?.done).toBe(true);
  });
});
