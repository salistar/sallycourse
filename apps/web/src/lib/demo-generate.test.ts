import { describe, expect, it } from 'vitest';
import { computeDemoExpiresAt, generateDemoCourse, hashDemoSeed, isDemoExpired } from './demo-generate';

// Tests purs (Prompt 96) : aucune I/O, aucune dépendance Mongo/Redis.

describe('generateDemoCourse', () => {
  it('produit 1 section avec 2 ou 3 leçons', () => {
    const demo = generateDemoCourse('Photographie culinaire');
    expect(demo.section.lessons.length).toBeGreaterThanOrEqual(2);
    expect(demo.section.lessons.length).toBeLessThanOrEqual(3);
  });

  it('chaque leçon a entre 2 et 3 slides avec narration non vide', () => {
    const demo = generateDemoCourse('Introduction à la guitare');
    for (const lesson of demo.section.lessons) {
      expect(lesson.slides.length).toBeGreaterThanOrEqual(2);
      expect(lesson.slides.length).toBeLessThanOrEqual(3);
      for (const slide of lesson.slides) {
        expect(slide.narration.trim().length).toBeGreaterThan(0);
        expect(slide.heading.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('est déterministe pour un même titre', () => {
    const a = generateDemoCourse('Cuisine végétarienne');
    const b = generateDemoCourse('Cuisine végétarienne');
    expect(a).toEqual(b);
  });

  it('tronque le titre à la limite Udemy et retombe sur un titre par défaut si vide', () => {
    const empty = generateDemoCourse('   ');
    expect(empty.title).toBe('Cours SallyCourse');

    const long = generateDemoCourse('x'.repeat(500));
    expect(long.title.length).toBeLessThanOrEqual(120);
  });

  it('hashDemoSeed est stable pour une même chaîne', () => {
    expect(hashDemoSeed('abc')).toBe(hashDemoSeed('abc'));
    expect(hashDemoSeed('abc')).not.toBe(hashDemoSeed('abd'));
  });
});

describe('TTL démo (pur)', () => {
  it('computeDemoExpiresAt ajoute 24h à la date de référence', () => {
    const now = new Date('2026-07-11T10:00:00.000Z');
    const expiresAt = computeDemoExpiresAt(now);
    expect(expiresAt.toISOString()).toBe('2026-07-12T10:00:00.000Z');
  });

  it('isDemoExpired est false avant expiration', () => {
    const now = new Date('2026-07-11T10:00:00.000Z');
    const expiresAt = computeDemoExpiresAt(now);
    const justBefore = new Date(expiresAt.getTime() - 1000);
    expect(isDemoExpired(expiresAt, justBefore)).toBe(false);
  });

  it('isDemoExpired est true au moment exact et après expiration', () => {
    const now = new Date('2026-07-11T10:00:00.000Z');
    const expiresAt = computeDemoExpiresAt(now);
    expect(isDemoExpired(expiresAt, expiresAt)).toBe(true);
    expect(isDemoExpired(expiresAt, new Date(expiresAt.getTime() + 1))).toBe(true);
  });
});
