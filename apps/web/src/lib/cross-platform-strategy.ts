import { z } from 'zod';

/**
 * Miroir web du module worker (apps/worker/src/deploy/cross-platform-strategy.ts,
 * Prompt 110) : même heuristique mock déterministe + tracking UTM, pour éviter
 * d'importer du code worker depuis le web (frontière app, cf. deploy-catalog.ts).
 * L'appel Claude réel suit le pattern de suggest-title/route.ts (fetch REST direct,
 * pas de SDK worker côté web).
 */

/* ------------------------------------------------------------------ */
/* Schéma de sortie (identique au worker)                               */
/* ------------------------------------------------------------------ */

const recommendedPlatformSchema = z.object({
  platform: z.string().min(1),
  mode: z.enum(['auto', 'assisted', 'manual']),
  rationale: z.string().min(1),
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

export type DeploymentStrategy = z.infer<typeof deploymentStrategySchema>;

/* ------------------------------------------------------------------ */
/* Tracking UTM unifié (identique au worker)                            */
/* ------------------------------------------------------------------ */

export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

export function slugifyUtm(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cours'
  );
}

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

export function buildUtmParams(courseId: string, courseTitle: string, platform: string): UtmParams {
  return {
    utm_source: platform.toLowerCase(),
    utm_medium: PLATFORM_MEDIUM[platform.toLowerCase()] ?? 'referral',
    utm_campaign: slugifyUtm(courseTitle),
    utm_content: slugifyUtm(courseId).slice(0, 24) || 'cours',
  };
}

/* ------------------------------------------------------------------ */
/* Heuristique mock (identique au worker)                               */
/* ------------------------------------------------------------------ */

type SubjectCategory = 'tech' | 'business' | 'creative' | 'lifestyle' | 'generic';

const CATEGORY_KEYWORDS: Record<Exclude<SubjectCategory, 'generic'>, string[]> = {
  tech: ['devops', 'code', 'coder', 'programmation', 'developpeur', 'développeur', 'python', 'javascript', 'react', 'docker', 'kubernetes', 'data', 'ia', 'intelligence artificielle', 'cloud', 'sql', 'linux', 'cybersecurite', 'cybersécurité'],
  business: ['marketing', 'vente', 'ventes', 'business', 'entrepreneuriat', 'finance', 'comptabilite', 'comptabilité', 'management', 'gestion', 'strategie', 'stratégie'],
  creative: ['design', 'photo', 'video', 'vidéo', 'montage', 'illustration', 'musique', 'dessin', 'ecriture', 'écriture'],
  lifestyle: ['cuisine', 'fitness', 'yoga', 'bien-etre', 'bien-être', 'sport', 'nutrition', 'developpement personnel', 'développement personnel'],
};

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

function genericStrategy(): DeploymentStrategy {
  return {
    recommendedPlatforms: [
      { platform: 'udemy', mode: 'auto', rationale: 'Plateforme LMS généraliste à forte audience, monétisation directe.', timing: 0 },
      { platform: 'youtube', mode: 'auto', rationale: 'Premières leçons gratuites en funnel pour capter du trafic vers le cours payant.', timing: 1 },
      { platform: 'linkedin', mode: 'assisted', rationale: 'Annonce de lancement et posts de suivi pour toucher une audience professionnelle.', timing: 2 },
    ],
    calendarPlan: [
      { platform: 'udemy', action: 'Publication du cours complet', dayOffset: 0 },
      { platform: 'youtube', action: 'Publication des 3 premières leçons en accès gratuit (funnel)', dayOffset: 1 },
      { platform: 'linkedin', action: 'Post de lancement avec lien vers le cours', dayOffset: 2 },
      { platform: 'linkedin', action: 'Post de rappel (témoignage/extrait)', dayOffset: 7 },
    ],
  };
}

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
export function mockDeploymentStrategy(title: string, description: string = ''): DeploymentStrategy {
  const category = detectSubjectCategory(title, description);
  if (category === 'generic') return genericStrategy();
  return MOCK_STRATEGIES[category];
}
