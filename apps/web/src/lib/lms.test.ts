import { describe, expect, it } from 'vitest';
import {
  cmiCheckoutStub,
  isCourseCompleted,
  mergeCompletedLesson,
  progressPercent,
  verificationQrDataUri,
} from './lms';

// Tests de la logique PURE du LMS interne (Prompt 43) : progression, complétion,
// STUB de paiement CMI et génération du data-URI de vérification. Aucun réseau/DB.

describe('progressPercent', () => {
  it('retourne 0 quand le total est nul', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(3, 0)).toBe(0);
  });

  it('arrondit et borne entre 0 et 100', () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(5, 5)).toBe(100);
    // Sur-complétion bornée à 100.
    expect(progressPercent(7, 5)).toBe(100);
  });
});

describe('isCourseCompleted', () => {
  it('faux si aucune leçon', () => {
    expect(isCourseCompleted(0, 0)).toBe(false);
  });
  it('vrai seulement quand toutes les leçons sont faites', () => {
    expect(isCourseCompleted(2, 3)).toBe(false);
    expect(isCourseCompleted(3, 3)).toBe(true);
  });
});

describe('mergeCompletedLesson', () => {
  const valid = ['a', 'b', 'c'];

  it('ajoute une leçon valide sans doublon', () => {
    expect(mergeCompletedLesson(['a'], 'b', valid).sort()).toEqual(['a', 'b']);
    expect(mergeCompletedLesson(['a', 'b'], 'b', valid).sort()).toEqual(['a', 'b']);
  });

  it('ignore une leçon hors du cours', () => {
    expect(mergeCompletedLesson(['a'], 'zzz', valid)).toEqual(['a']);
  });

  it('purge les ids devenus invalides', () => {
    expect(mergeCompletedLesson(['a', 'obsolete'], 'c', valid).sort()).toEqual(['a', 'c']);
  });
});

describe('cmiCheckoutStub', () => {
  it('accorde l’accès pour un cours gratuit', () => {
    expect(cmiCheckoutStub(0, false).granted).toBe(true);
  });
  it('accorde l’accès en mode mock même payant', () => {
    const r = cmiCheckoutStub(4900, true);
    expect(r.granted).toBe(true);
    expect(r.reason).toContain('[mock]');
  });
  it('refuse un cours payant hors mock (Phase 4)', () => {
    expect(cmiCheckoutStub(4900, false).granted).toBe(false);
  });
});

describe('verificationQrDataUri', () => {
  it('produit un data-URI SVG déterministe', () => {
    const a = verificationQrDataUri('abc123');
    const b = verificationQrDataUri('abc123');
    expect(a).toBe(b);
    expect(a.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
  it('varie selon l’identifiant', () => {
    expect(verificationQrDataUri('one')).not.toBe(verificationQrDataUri('two'));
  });
});
