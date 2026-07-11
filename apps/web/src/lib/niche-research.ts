import { z } from 'zod';
import { getConfig, templateCategorySchema, type TemplateCategory } from '@sallycourse/shared';
import { logger } from './logger';

/**
 * Recherche de niche (P86) — outil « Trouver un sujet » du dashboard.
 * findNicheOpportunities(category) tente un best-effort de signal externe
 * (fetch simple d'une page de résultats publique) puis, dans tous les cas,
 * croise avec une bibliothèque de tendances mockées déterministes pour
 * produire une liste de candidats scorés.
 *
 * IMPORTANT — le scraping Udemy réel est fragile et NON contractuel (structure
 * HTML changeante, anti-bot, ToS) : on ne dépend JAMAIS d'un scraping Udemy
 * pour le résultat. Le "fetch best-effort" ci-dessous cible uniquement une
 * source publique tolérante (ex. Wikipedia) pour enrichir un signal de
 * popularité approximatif ; en cas d'échec (réseau, MOCK_PROVIDERS, timeout),
 * on retombe intégralement sur la bibliothèque de tendances mockées — jamais
 * d'erreur remontée à l'appelant.
 */

export const nicheCandidateSchema = z.object({
  title: z.string().min(3).max(160),
  estimatedCourseCount: z.number().int().min(0),
  avgRating: z.number().min(0).max(5),
  avgPrice: z.number().min(0),
  /** Score de demande estimé (0-100, plus haut = plus demandé). */
  demandScore: z.number().min(0).max(100),
  /** Score de concurrence estimé (0-100, plus haut = plus saturé). */
  competitionScore: z.number().min(0).max(100),
});
export type NicheCandidate = z.infer<typeof nicheCandidateSchema>;

export const nicheResearchResultSchema = z.object({
  category: templateCategorySchema,
  candidates: z.array(nicheCandidateSchema),
  /** Vrai si le signal externe best-effort a pu être joint (sinon 100% mock). */
  liveSignal: z.boolean(),
});
export type NicheResearchResult = z.infer<typeof nicheResearchResultSchema>;

/* ------------------------------------------------------------------ */
/* Bibliothèque de tendances (mock déterministe, par catégorie)         */
/* ------------------------------------------------------------------ */

/**
 * Sujets populaires par catégorie — pondération déterministe (popularity 0-100
 * = proxy de demande brute, saturation 0-100 = proxy de concurrence brute).
 * Valeurs choisies à dire d'expert (best-effort), pas issues d'une API tierce.
 */
interface TrendSeed {
  title: string;
  popularity: number;
  saturation: number;
  baseCourseCount: number;
  baseRating: number;
  basePrice: number;
}

const TREND_LIBRARY: Record<TemplateCategory, readonly TrendSeed[]> = {
  devops: [
    { title: 'Kubernetes pour développeurs', popularity: 88, saturation: 62, baseCourseCount: 340, baseRating: 4.5, basePrice: 69 },
    { title: 'CI/CD avec GitLab et GitHub Actions', popularity: 74, saturation: 55, baseCourseCount: 210, baseRating: 4.4, basePrice: 59 },
    { title: 'Terraform et Infrastructure as Code', popularity: 70, saturation: 48, baseCourseCount: 180, baseRating: 4.6, basePrice: 64 },
    { title: 'Docker de zéro à la production', popularity: 82, saturation: 70, baseCourseCount: 420, baseRating: 4.4, basePrice: 49 },
    { title: 'Observabilité et monitoring (Prometheus/Grafana)', popularity: 58, saturation: 30, baseCourseCount: 90, baseRating: 4.5, basePrice: 59 },
    { title: 'Sécurité DevSecOps pour pipelines CI/CD', popularity: 52, saturation: 25, baseCourseCount: 60, baseRating: 4.6, basePrice: 69 },
  ],
  office: [
    { title: 'Excel avancé : tableaux croisés dynamiques', popularity: 90, saturation: 80, baseCourseCount: 520, baseRating: 4.5, basePrice: 39 },
    { title: 'Power BI pour l’analyse de données', popularity: 80, saturation: 55, baseCourseCount: 260, baseRating: 4.6, basePrice: 54 },
    { title: 'Automatisation de rapports avec macros VBA', popularity: 60, saturation: 35, baseCourseCount: 120, baseRating: 4.4, basePrice: 44 },
    { title: 'Google Sheets pour la gestion d’entreprise', popularity: 55, saturation: 28, baseCourseCount: 85, baseRating: 4.3, basePrice: 34 },
    { title: 'Notion pour organiser son travail', popularity: 68, saturation: 40, baseCourseCount: 150, baseRating: 4.5, basePrice: 29 },
    { title: 'PowerPoint : présentations qui marquent', popularity: 50, saturation: 45, baseCourseCount: 200, baseRating: 4.2, basePrice: 29 },
  ],
  languages: [
    { title: 'Anglais professionnel pour réunions et e-mails', popularity: 85, saturation: 65, baseCourseCount: 300, baseRating: 4.5, basePrice: 44 },
    { title: 'Espagnol conversationnel pour voyager', popularity: 78, saturation: 60, baseCourseCount: 280, baseRating: 4.4, basePrice: 39 },
    { title: 'Prononciation anglaise sans accent', popularity: 62, saturation: 38, baseCourseCount: 110, baseRating: 4.6, basePrice: 49 },
    { title: 'Français langue étrangère (FLE) débutant', popularity: 48, saturation: 22, baseCourseCount: 70, baseRating: 4.5, basePrice: 34 },
    { title: 'Allemand des affaires', popularity: 40, saturation: 18, baseCourseCount: 45, baseRating: 4.4, basePrice: 54 },
    { title: 'Préparation certification TOEIC/IELTS', popularity: 66, saturation: 50, baseCourseCount: 190, baseRating: 4.3, basePrice: 59 },
  ],
  business: [
    { title: 'Devenir freelance : trouver ses premiers clients', popularity: 82, saturation: 58, baseCourseCount: 240, baseRating: 4.5, basePrice: 49 },
    { title: 'Marketing digital pour indépendants', popularity: 76, saturation: 62, baseCourseCount: 310, baseRating: 4.4, basePrice: 54 },
    { title: 'Fixer ses tarifs et négocier avec confiance', popularity: 58, saturation: 30, baseCourseCount: 95, baseRating: 4.6, basePrice: 44 },
    { title: 'Créer son business plan simple et actionnable', popularity: 54, saturation: 32, baseCourseCount: 100, baseRating: 4.3, basePrice: 39 },
    { title: 'Comptabilité de base pour créateurs d’entreprise', popularity: 46, saturation: 20, baseCourseCount: 65, baseRating: 4.5, basePrice: 49 },
    { title: 'Vendre ses services en ligne (offres et tunnels)', popularity: 70, saturation: 48, baseCourseCount: 170, baseRating: 4.4, basePrice: 59 },
  ],
};

/* ------------------------------------------------------------------ */
/* Calcul PUR des scores (testable sans I/O)                           */
/* ------------------------------------------------------------------ */

/**
 * Combine une graine de tendance et un éventuel boost de signal externe
 * (0-100, 0 = aucun boost) pour produire un candidat scoré complet.
 * Calcul déterministe et pur — aucune dépendance réseau/horloge.
 */
export function computeNicheCandidate(seed: TrendSeed, externalBoost = 0): NicheCandidate {
  const clampedBoost = Math.max(0, Math.min(100, externalBoost));
  // La demande combine popularité de base et boost externe (poids 70/30).
  const demandScore = Math.round(seed.popularity * 0.7 + clampedBoost * 0.3);
  // La concurrence combine saturation de base et un soupçon du boost externe
  // (un sujet en vogue attire aussi plus de créateurs de cours).
  const competitionScore = Math.round(seed.saturation * 0.85 + clampedBoost * 0.15);

  return {
    title: seed.title,
    estimatedCourseCount: seed.baseCourseCount,
    avgRating: seed.baseRating,
    avgPrice: seed.basePrice,
    demandScore: Math.max(0, Math.min(100, demandScore)),
    competitionScore: Math.max(0, Math.min(100, competitionScore)),
  };
}

/**
 * Trie les candidats par opportunité décroissante : forte demande, faible
 * concurrence. Calcul PUR — score d'opportunité = demandScore - competitionScore,
 * departage par demandScore puis titre (stabilité déterministe).
 */
export function rankNicheCandidates(candidates: readonly NicheCandidate[]): NicheCandidate[] {
  return [...candidates].sort((a, b) => {
    const opportunityA = a.demandScore - a.competitionScore;
    const opportunityB = b.demandScore - b.competitionScore;
    if (opportunityB !== opportunityA) return opportunityB - opportunityA;
    if (b.demandScore !== a.demandScore) return b.demandScore - a.demandScore;
    return a.title.localeCompare(b.title);
  });
}

/* ------------------------------------------------------------------ */
/* Signal externe best-effort (fetch simple, jamais bloquant)          */
/* ------------------------------------------------------------------ */

/** Délai maximal accordé au fetch best-effort avant abandon. */
const FETCH_TIMEOUT_MS = 3_000;

/**
 * Tente un signal de popularité externe best-effort : interroge l'API REST
 * publique de Wikipedia (pageviews) pour le terme de catégorie — source
 * stable, publique, sans ToS restrictive, contrairement au scraping Udemy
 * (fragile, anti-bot, non contractuel — volontairement évité ici).
 * Retourne un boost 0-100 dérivé du volume de vues, ou `undefined` si le
 * signal n'a pas pu être obtenu (réseau, timeout, réponse inattendue) — dans
 * ce cas l'appelant retombe entièrement sur le score mock.
 */
async function fetchExternalSignal(category: TemplateCategory): Promise<number | undefined> {
  const topicByCategory: Record<TemplateCategory, string> = {
    devops: 'DevOps',
    office: 'Microsoft_Excel',
    languages: 'Language_education',
    business: 'Entrepreneurship',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const topic = topicByCategory[category];
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as { extract?: unknown };
    if (typeof data.extract !== 'string' || data.extract.length === 0) return undefined;

    // Signal grossier : longueur de l'extrait ⇒ maturité/notoriété du sujet.
    // Purement indicatif — normalisé sur 0-100.
    const boost = Math.max(0, Math.min(100, Math.round(data.extract.length / 4)));
    return boost;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                       */
/* ------------------------------------------------------------------ */

/**
 * Trouve des opportunités de niche pour une catégorie donnée. Croise la
 * bibliothèque de tendances mockées avec un signal externe best-effort
 * (jamais requis : indisponibilité → 100% mock, jamais d'erreur remontée).
 */
export async function findNicheOpportunities(
  category: TemplateCategory,
  options: { mockOnly?: boolean } = {},
): Promise<NicheResearchResult> {
  const seeds = TREND_LIBRARY[category];

  // MOCK_PROVIDERS=true (env de test/CI) : jamais d'appel réseau réel,
  // conformément à la règle mock-friendly du projet.
  const mockOnly = options.mockOnly ?? getConfig().MOCK_PROVIDERS;

  let boost: number | undefined;
  if (!mockOnly) {
    try {
      boost = await fetchExternalSignal(category);
    } catch (err) {
      logger.warn({ err: (err as Error).message, category }, 'findNicheOpportunities : signal externe indisponible, repli mock');
      boost = undefined;
    }
  }

  const candidates = rankNicheCandidates(seeds.map((seed) => computeNicheCandidate(seed, boost ?? 0)));

  return {
    category,
    candidates,
    liveSignal: boost !== undefined,
  };
}
