// Prompt 110 — Orchestration cross-platform intelligente.
//
// Recommande une stratégie de déploiement multi-plateformes à partir du sujet/
// niveau/langue d'un cours : plateformes cibles + mode + rationale, calendrier
// de publication échelonné (dayOffset relatif au lancement), et paramètres UTM
// unifiés injectables dans les liens de description de chaque plateforme.
//
// - Mode réel : un appel callClaudeJson (schéma structuré ci-dessous).
// - Mode mock (MOCK_PROVIDERS=true ou clé absente) : heuristique locale
//   déterministe par catégorie de sujet — aucun appel réseau, testable hors-ligne.
//
// Intégration future (planificateur de déploiements programmés, P181) : ce
// module NE PLANIFIE PAS lui-même les jobs — il produit un `calendarPlan`
// (liste d'actions datées en jour relatif). Tant qu'aucun scheduler de
// déploiements différés n'existe, ce plan est purement informatif côté UI
// (affiché auporteur du cours). Quand P181 (ou équivalent) sera livré, le
// point d'intégration est : pour chaque entrée `calendarPlan`, enfiler un job
// BullMQ différé (`delay: dayOffset * 24h`) vers la queue `deployment` avec le
// `platform`/`mode` résolus — réutiliser `getDeploymentQueue` (apps/web) ou
// l'équivalent worker, sans dupliquer la logique d'enfilement déjà présente
// dans POST /api/courses/[id]/deploy.

import { z } from 'zod';
import type { ICourse } from '../shared.js';
import { getConfig } from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';

/* ------------------------------------------------------------------ */
/* Schéma de sortie                                                     */
/* ------------------------------------------------------------------ */

const recommendedPlatformSchema = z.object({
  platform: z.string().min(1),
  mode: z.enum(['auto', 'assisted', 'manual']),
  rationale: z.string().min(1),
  /** Décalage en jours depuis le lancement (0 = jour J). */
  timing: z.number().int().min(0),
});

const calendarEntrySchema = z.object({
  platform: z.string().min(1),
  action: z.string().min(1),
  dayOffset: z.number().int().min(0),
});

export const deploymentStrategySchema = z.object({
  recommendedPlatforms: z.array(recommendedPlatformSchema).min(1),
  calendarPlan: z.array(calendarEntrySchema),
});

export type RecommendedPlatform = z.infer<typeof recommendedPlatformSchema>;
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
export type DeploymentStrategy = z.infer<typeof deploymentStrategySchema>;

/* ------------------------------------------------------------------ */
/* Tracking UTM unifié                                                  */
/* ------------------------------------------------------------------ */

/** Un jeu de paramètres UTM cohérent pour un (cours, plateforme). */
export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

/** Nettoie une chaîne en slug UTM (minuscules, tirets, sans accents/espaces). */
export function slugifyUtm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cours';
}

/** Médium par défaut selon la nature de la plateforme (vidéo vs LMS vs social). */
const PLATFORM_MEDIUM: Record<string, string> = {
  youtube: 'video',
  tiktok: 'social',
  linkedin: 'social',
  'linkedin-learning': 'lms',
  udemy: 'lms',
  skillshare: 'lms',
  teachable: 'lms',
  thinkific: 'lms',
  podia: 'lms',
  gumroad: 'store',
  moodle: 'lms',
  hotmart: 'store',
  'systeme-io': 'funnel',
  kajabi: 'lms',
  'coursera-edx': 'lms',
};

/**
 * Construit les paramètres UTM d'un (cours, plateforme), déterministes et
 * stables (même cours + même plateforme → mêmes paramètres, rejouable).
 */
export function buildUtmParams(courseId: string, courseTitle: string, platform: string): UtmParams {
  return {
    utm_source: platform.toLowerCase(),
    utm_medium: PLATFORM_MEDIUM[platform.toLowerCase()] ?? 'referral',
    utm_campaign: slugifyUtm(courseTitle),
    utm_content: slugifyUtm(courseId).slice(0, 24) || 'cours',
  };
}

/** Sérialise les paramètres UTM en query string (sans point d'interrogation). */
export function utmQueryString(params: UtmParams): string {
  const usp = new URLSearchParams(Object.entries(params));
  return usp.toString();
}

/** Injecte les paramètres UTM dans une URL (préserve les query params existants). */
export function injectUtmIntoUrl(url: string, params: UtmParams): string {
  try {
    const u = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      u.searchParams.set(key, value);
    }
    return u.toString();
  } catch {
    // URL invalide : on retombe sur une concaténation best-effort.
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${utmQueryString(params)}`;
  }
}

/* ------------------------------------------------------------------ */
/* Heuristique mock (déterministe, par catégorie de sujet)             */
/* ------------------------------------------------------------------ */

/** Catégories de sujet détectées par mots-clés simples dans le titre/outline. */
type SubjectCategory = 'tech' | 'business' | 'creative' | 'lifestyle' | 'generic';

const CATEGORY_KEYWORDS: Record<Exclude<SubjectCategory, 'generic'>, string[]> = {
  tech: ['devops', 'code', 'coder', 'programmation', 'developpeur', 'développeur', 'python', 'javascript', 'react', 'docker', 'kubernetes', 'data', 'ia', 'intelligence artificielle', 'cloud', 'sql', 'linux', 'cybersecurite', 'cybersécurité'],
  business: ['marketing', 'vente', 'ventes', 'business', 'entrepreneuriat', 'finance', 'comptabilite', 'comptabilité', 'management', 'gestion', 'strategie', 'stratégie'],
  creative: ['design', 'photo', 'video', 'vidéo', 'montage', 'illustration', 'musique', 'dessin', 'ecriture', 'écriture'],
  lifestyle: ['cuisine', 'fitness', 'yoga', 'bien-etre', 'bien-être', 'sport', 'nutrition', 'developpement personnel', 'développement personnel'],
};

/** Détecte la catégorie de sujet à partir du titre + description (mots-clés). */
export function detectSubjectCategory(title: string, description: string = ''): SubjectCategory {
  const haystack = `${title} ${description}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [
    Exclude<SubjectCategory, 'generic'>,
    string[],
  ][]) {
    if (keywords.some((k) => haystack.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()))) {
      return category;
    }
  }
  return 'generic';
}

/** Plan par défaut (générique) : funnel Udemy + YouTube teaser, réutilisé si aucune catégorie ne matche. */
function genericStrategy(locale: string): DeploymentStrategy {
  const linkedinPlatform = locale === 'fr' ? 'linkedin' : 'linkedin';
  return {
    recommendedPlatforms: [
      { platform: 'udemy', mode: 'auto', rationale: 'Plateforme LMS généraliste à forte audience, monétisation directe.', timing: 0 },
      { platform: 'youtube', mode: 'auto', rationale: 'Premières leçons gratuites en funnel pour capter du trafic vers le cours payant.', timing: 1 },
      { platform: linkedinPlatform, mode: 'assisted', rationale: 'Annonce de lancement et posts de suivi pour toucher une audience professionnelle.', timing: 2 },
    ],
    calendarPlan: [
      { platform: 'udemy', action: 'Publication du cours complet', dayOffset: 0 },
      { platform: 'youtube', action: 'Publication des 3 premières leçons en accès gratuit (funnel)', dayOffset: 1 },
      { platform: linkedinPlatform, action: 'Post de lancement avec lien vers le cours', dayOffset: 2 },
      { platform: linkedinPlatform, action: 'Post de rappel (témoignage/extrait)', dayOffset: 7 },
    ],
  };
}

/** Stratégies mock par catégorie — heuristique simple, sans appel réseau. */
const MOCK_STRATEGIES: Record<Exclude<SubjectCategory, 'generic'>, DeploymentStrategy> = {
  tech: {
    recommendedPlatforms: [
      { platform: 'udemy', mode: 'auto', rationale: 'Cours technique : Udemy reste la référence payante pour ce public développeur.', timing: 0 },
      { platform: 'youtube', mode: 'auto', rationale: 'Les 3 premières leçons gratuites en funnel génèrent du trafic qualifié vers Udemy.', timing: 1 },
      { platform: 'linkedin', mode: 'assisted', rationale: "Public professionnel technique très présent sur LinkedIn, posts d'expertise à fort impact.", timing: 2 },
      { platform: 'tiktok', mode: 'assisted', rationale: 'Clips courts (astuces/démos rapides) pour toucher une audience plus jeune de développeurs.', timing: 4 },
    ],
    calendarPlan: [
      { platform: 'udemy', action: 'Publication du cours complet (payant)', dayOffset: 0 },
      { platform: 'youtube', action: '3 premières leçons gratuites en funnel', dayOffset: 1 },
      { platform: 'linkedin', action: 'Post de lancement + lien Udemy tracké', dayOffset: 2 },
      { platform: 'tiktok', action: 'Clip démo 30-60s (extrait le plus accrocheur)', dayOffset: 4 },
      { platform: 'linkedin', action: 'Post de suivi (retours des premiers élèves)', dayOffset: 10 },
    ],
  },
  business: {
    recommendedPlatforms: [
      { platform: 'udemy', mode: 'auto', rationale: 'Large catalogue business, bonne visibilité organique sur ce type de sujet.', timing: 0 },
      { platform: 'linkedin', mode: 'assisted', rationale: 'Audience business/décideurs naturellement présente, fort potentiel de conversion.', timing: 0 },
      { platform: 'systeme-io', mode: 'auto', rationale: 'Funnel de vente dédié pour capter des leads qualifiés en direct (sans intermédiaire).', timing: 1 },
    ],
    calendarPlan: [
      { platform: 'udemy', action: 'Publication du cours complet', dayOffset: 0 },
      { platform: 'linkedin', action: 'Post de lancement ciblant les décideurs', dayOffset: 0 },
      { platform: 'systeme-io', action: 'Mise en ligne du funnel de vente + page de capture', dayOffset: 1 },
      { platform: 'linkedin', action: 'Étude de cas / témoignage client', dayOffset: 7 },
    ],
  },
  creative: {
    recommendedPlatforms: [
      { platform: 'skillshare', mode: 'assisted', rationale: 'Audience naturellement orientée projets créatifs, format communautaire adapté.', timing: 0 },
      { platform: 'youtube', mode: 'auto', rationale: "Le rendu visuel se prête bien à des extraits gratuits qui donnent envie d'aller plus loin.", timing: 1 },
      { platform: 'tiktok', mode: 'assisted', rationale: 'Format court très efficace pour montrer un avant/après ou un processus créatif.', timing: 2 },
    ],
    calendarPlan: [
      { platform: 'skillshare', action: 'Publication du cours complet', dayOffset: 0 },
      { platform: 'youtube', action: 'Extrait gratuit (teaser) en funnel', dayOffset: 1 },
      { platform: 'tiktok', action: 'Clip avant/après ou processus créatif', dayOffset: 2 },
    ],
  },
  lifestyle: {
    recommendedPlatforms: [
      { platform: 'udemy', mode: 'auto', rationale: 'Bonne visibilité organique pour les sujets bien-être/développement personnel.', timing: 0 },
      { platform: 'youtube', mode: 'auto', rationale: 'Format vidéo naturel pour ce type de contenu, funnel gratuit efficace.', timing: 1 },
      { platform: 'tiktok', mode: 'assisted', rationale: 'Public très actif sur les formats courts lifestyle/bien-être.', timing: 3 },
    ],
    calendarPlan: [
      { platform: 'udemy', action: 'Publication du cours complet', dayOffset: 0 },
      { platform: 'youtube', action: 'Leçon gratuite en funnel', dayOffset: 1 },
      { platform: 'tiktok', action: 'Clip astuce rapide', dayOffset: 3 },
    ],
  },
};

/** Stratégie mock déterministe (aucun appel réseau) selon la catégorie détectée. */
function mockStrategy(course: Pick<ICourse, 'title' | 'locale'>, description: string): DeploymentStrategy {
  const category = detectSubjectCategory(course.title, description);
  if (category === 'generic') return genericStrategy(course.locale ?? 'fr');
  return MOCK_STRATEGIES[category];
}

/* ------------------------------------------------------------------ */
/* Recommandation via Claude (ou mock)                                  */
/* ------------------------------------------------------------------ */

/** Description exploitée pour l'analyse (outline.description si présent, sinon vide). */
function courseDescription(course: ICourse): string {
  const outline = course.outline as { description?: string } | null | undefined;
  return (outline?.description ?? '').trim();
}

/**
 * Recommande une stratégie de déploiement cross-platform pour un cours :
 * plateformes + mode + rationale, calendrier échelonné, en s'appuyant sur le
 * sujet/niveau/langue du cours. Mode mock (MOCK_PROVIDERS ou clé absente) :
 * heuristique locale déterministe par catégorie de sujet.
 */
export async function recommendDeploymentStrategy(course: ICourse): Promise<DeploymentStrategy> {
  const description = courseDescription(course);
  const config = getConfig();
  const mock = config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY;

  if (mock) {
    return mockStrategy(course, description);
  }

  const system =
    'Tu es un expert en distribution de formations en ligne (marketing multi-plateformes). ' +
    "À partir du sujet, du niveau et de la langue d'un cours, recommande une stratégie de " +
    'déploiement cross-platform réaliste (ex. Udemy payant + YouTube en funnel gratuit + posts ' +
    'LinkedIn + clips courts programmés). Réponds en JSON strict : ' +
    '{ "recommendedPlatforms": [ { "platform": string, "mode": "auto"|"assisted"|"manual", ' +
    '"rationale": string, "timing": number } ], "calendarPlan": [ { "platform": string, ' +
    '"action": string, "dayOffset": number } ] }. ' +
    'timing/dayOffset sont des décalages en JOURS depuis le lancement (0 = jour J, entiers ≥ 0). ' +
    'Langue de la rationale/action : français.';
  const user = JSON.stringify({
    title: course.title,
    difficulty: course.difficulty,
    locale: course.locale,
    targetPlatforms: course.targetPlatforms,
    description,
  });

  return callClaudeJson({ schema: deploymentStrategySchema, system, user });
}
