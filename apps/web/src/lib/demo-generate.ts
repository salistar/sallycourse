import { UDEMY } from '@sallycourse/shared';
import { DEMO_COURSE_TTL_HOURS, type IDemoLesson } from '@sallycourse/db';

/**
 * Générateur du mini cours de démo public (Prompt 96) — POST /api/demo/generate.
 * TOUJOURS déterministe et mock : aucune clé API, aucun coût, jamais d'appel
 * réseau réel, même si ANTHROPIC_API_KEY est présente et MOCK_PROVIDERS=false
 * (voir isolation forcée dans la route). Reprend le style des fixtures worker
 * (mock-fixtures.ts) en autonome côté web — pas de dépendance cross-app vers
 * apps/worker.
 */

/** Hash FNV-1a 32 bits — déterministe, même algorithme que le worker. */
export function hashDemoSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const LESSON_TITLE_TEMPLATES = ['Découvrir %s', 'Les bases de %s en pratique', '%s pas à pas'] as const;

const SLIDE_HEADINGS = ['Contexte et objectif', 'Démonstration guidée', 'Récapitulatif'] as const;

/** Narration courte déterministe (aperçu, pas de volume calé sur un débit TTS). */
function demoNarration(topic: string, heading: string, index: number): string {
  return (
    `${heading} : nous découvrons ${topic} avec un exemple concret dès le début. ` +
    `Ce point ${index + 1} illustre l'essentiel à retenir avant de passer à la pratique.`
  );
}

/** Construit les 2-3 slides d'aperçu d'une leçon (title/content/recap simplifié). */
function buildDemoSlides(topic: string): { heading: string; bullets: string[]; narration: string }[] {
  return SLIDE_HEADINGS.map((heading, i) => ({
    heading,
    bullets: [`Point clé ${i + 1} sur ${topic}`, `Exemple appliqué à ${topic}`],
    narration: demoNarration(topic, heading, i),
  }));
}

export interface DemoCoursePreview {
  title: string;
  section: {
    title: string;
    lessons: IDemoLesson[];
  };
}

/**
 * Génère un mini cours de démo mock (1 section, 2-3 leçons) à partir d'un
 * titre libre saisi sur la landing. Déterministe par titre (même saisie →
 * même aperçu), aucune I/O.
 */
export function generateDemoCourse(rawTitle: string): DemoCoursePreview {
  const title = rawTitle.trim().slice(0, UDEMY.TITLE_MAX_CHARS) || 'Cours SallyCourse';
  const seed = hashDemoSeed(title);
  // 2 ou 3 leçons selon le titre — variété sans complexité inutile pour une démo.
  const lessonCount = 2 + (seed % 2);

  const lessons: IDemoLesson[] = Array.from({ length: lessonCount }, (_, i) => {
    const template = LESSON_TITLE_TEMPLATES[(seed + i) % LESSON_TITLE_TEMPLATES.length] ?? '%s';
    return {
      title: template.replace('%s', title),
      type: 'video',
      durationMin: 4 + ((seed + i * 3) % 4),
      slides: buildDemoSlides(title),
    };
  });

  return {
    title,
    section: {
      title: `Découverte de ${title}`,
      lessons,
    },
  };
}

/** Instant d'expiration TTL (24h) à partir d'une date de référence — fonction pure, testable. */
export function computeDemoExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEMO_COURSE_TTL_HOURS * 60 * 60 * 1000);
}

/** Un aperçu de démo est expiré si `expiresAt` est passé — fonction pure, testable. */
export function isDemoExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}
