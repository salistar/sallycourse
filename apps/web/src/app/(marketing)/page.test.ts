import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

/**
 * Smoke test de la landing page (P95) : pas de harnais de rendu React installé
 * dans ce projet (@testing-library/react absent), donc on vérifie que les clés
 * i18n consommées par chaque section de la page existent bien dans les trois
 * bundles de messages, avec la même forme (tableaux de même longueur).
 */

const BUNDLES = { fr, en, ar } as const;

describe('marketing landing page — i18n', () => {
  it('expose le namespace marketing dans les trois locales', () => {
    for (const bundle of Object.values(BUNDLES)) {
      expect(bundle.marketing).toBeDefined();
    }
  });

  it('section hero : badge/title/subtitle/CTA présents', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const hero = bundle.marketing.hero;
      expect(hero.badge).toBeTruthy();
      expect(hero.title).toBeTruthy();
      expect(hero.subtitle).toBeTruthy();
      expect(hero.ctaPrimary).toBeTruthy();
      expect(hero.ctaSecondary).toBeTruthy();
    }
  });

  it('section comparatif avant/après : listes non vides et alignées', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const comparison = bundle.marketing.comparison;
      expect(comparison.before.length).toBeGreaterThan(0);
      expect(comparison.after.length).toBe(comparison.before.length);
    }
  });

  it('section fonctionnalités : au moins 6 items avec titre + description', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const items = bundle.marketing.features.items;
      expect(items.length).toBeGreaterThanOrEqual(6);
      for (const item of items) {
        expect(item.title).toBeTruthy();
        expect(item.description).toBeTruthy();
      }
    }
  });

  it('section FAQ : chaque item a une question et une réponse', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const items = bundle.marketing.faq.items;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.question).toBeTruthy();
        expect(item.answer).toBeTruthy();
      }
    }
  });

  it('section témoignages de repli : quote/author/rating cohérents', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const empty = bundle.marketing.testimonials.empty;
      expect(empty.length).toBeGreaterThan(0);
      for (const t of empty) {
        expect(t.quote).toBeTruthy();
        expect(t.author).toBeTruthy();
        expect(t.rating).toBeGreaterThanOrEqual(1);
        expect(t.rating).toBeLessThanOrEqual(5);
      }
    }
  });

  it('footer : liens produit/entreprise/légal présents', () => {
    for (const bundle of Object.values(BUNDLES)) {
      const links = bundle.marketing.footer.links;
      expect(links.features).toBeTruthy();
      expect(links.pricing).toBeTruthy();
      expect(links.cgu).toBeTruthy();
      expect(links.cgv).toBeTruthy();
      expect(links.privacy).toBeTruthy();
    }
  });

  it('les trois locales exposent le même jeu de clés top-level dans marketing', () => {
    const [frKeys, enKeys, arKeys] = Object.values(BUNDLES).map((b) =>
      Object.keys(b.marketing).sort(),
    );
    expect(enKeys).toEqual(frKeys);
    expect(arKeys).toEqual(frKeys);
  });
});
