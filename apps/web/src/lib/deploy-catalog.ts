import type { DeploymentMode } from '@sallycourse/db';
import { PLATFORMS, getPlatformMeta, type PlatformMeta } from './platforms';

/**
 * Catalogue de déploiement côté web : reflète les CAPACITÉS déclarées par les
 * adapters du worker (apps/worker/src/deploy/adapters/*) sans importer le code
 * worker (frontière app). Source unique pour l'écran « Déployer » (modes
 * disponibles, besoin navigateur, estimation de durée) et pour la validation de
 * l'API POST /deploy. À garder synchronisé avec les capabilities des adapters.
 */

/** Capacités d'un adapter (miroir de DeploymentAdapter.capabilities). */
export interface PlatformCapabilities {
  modes: DeploymentMode[];
  /** true → certaines opérations passent par un navigateur headless (plus lent). */
  needsBrowser: boolean;
}

/**
 * Capacités par plateforme, alignées sur les adapters enregistrés côté worker.
 * (udemy/podia/gumroad/skillshare/internal/youtube/moodle/teachable/thinkific)
 */
const CAPABILITIES: Record<string, PlatformCapabilities> = {
  udemy: { modes: ['assisted', 'auto', 'manual'], needsBrowser: true },
  youtube: { modes: ['auto', 'assisted'], needsBrowser: false },
  teachable: { modes: ['auto', 'assisted', 'manual'], needsBrowser: true },
  thinkific: { modes: ['auto', 'assisted', 'manual'], needsBrowser: false },
  podia: { modes: ['auto', 'assisted'], needsBrowser: true },
  gumroad: { modes: ['auto'], needsBrowser: false },
  skillshare: { modes: ['auto', 'assisted'], needsBrowser: true },
  moodle: { modes: ['auto', 'assisted'], needsBrowser: false },
  internal: { modes: ['auto', 'assisted', 'manual'], needsBrowser: false },
};

/** Capacités par défaut si une plateforme n'est pas cataloguée (prudence). */
const DEFAULT_CAPABILITIES: PlatformCapabilities = {
  modes: ['auto'],
  needsBrowser: false,
};

/** Niveau de risque d'une combinaison (plateforme, mode). */
export type DeployRiskLevel = 'tos';

/** Avertissement de risque dérivé d'une combinaison (plateforme, mode). */
export interface DeployRisk {
  level: DeployRiskLevel;
  /** Libellé court du badge. */
  label: string;
  /** Explication affichée en infobulle / détail. */
  detail: string;
}

/** Risque CGU indexé par mode (uniquement les modes à risque). */
export type PlatformRisks = Partial<Record<DeploymentMode, DeployRisk>>;

/** Entrée du catalogue exposée à l'UI et à l'API. */
export interface DeployCatalogEntry {
  id: string;
  label: string;
  description: string;
  kind: PlatformMeta['kind'];
  capabilities: PlatformCapabilities;
  /** Risque CGU dérivé par mode (badge). Mode absent = aucun risque connu. */
  risks: PlatformRisks;
}

/** Capacités d'une plateforme (jamais undefined : fallback prudent). */
export function getCapabilities(platformId: string): PlatformCapabilities {
  return CAPABILITIES[platformId] ?? DEFAULT_CAPABILITIES;
}

/**
 * Risque dérivé (PUR, sans I/O) d'une combinaison (plateforme, mode).
 * Règle actuelle : une plateforme sans API publique (needsBrowser) pilotée en
 * mode `auto` s'appuie sur de l'automatisation navigateur, souvent contraire
 * aux CGU de la plateforme → on affiche un badge d'avertissement. Les modes
 * `assisted`/`manual` gardent l'humain dans la boucle : pas de risque dérivé.
 * Aucun nouveau champ DB : la dérivation est recalculée à la volée.
 */
export function deployRiskFor(platformId: string, mode: DeploymentMode): DeployRisk | null {
  const caps = getCapabilities(platformId);
  if (caps.needsBrowser && mode === 'auto') {
    return {
      level: 'tos',
      label: 'Automatisation navigateur — CGU',
      detail:
        "Cette plateforme n'a pas d'API publique : le mode automatique pilote un " +
        'navigateur, ce qui peut enfreindre ses conditions d’utilisation. Préférez ' +
        'le mode assisté ou manuel pour rester conforme.',
    };
  }
  return null;
}

/** Table des risques par mode supporté d'une plateforme (modes sains omis). */
export function buildRisks(platformId: string): PlatformRisks {
  const caps = getCapabilities(platformId);
  const risks: PlatformRisks = {};
  for (const mode of caps.modes) {
    const risk = deployRiskFor(platformId, mode);
    if (risk) risks[mode] = risk;
  }
  return risks;
}

/** Catalogue complet : métadonnées plateforme + capacités adapter + risques. */
export function buildCatalog(): DeployCatalogEntry[] {
  return PLATFORMS.map((meta) => ({
    id: meta.id,
    label: meta.label,
    description: meta.description,
    kind: meta.kind,
    capabilities: getCapabilities(meta.id),
    risks: buildRisks(meta.id),
  }));
}

/** Vrai si la plateforme existe (métadonnées connues). */
export function isKnownPlatform(id: string): boolean {
  return getPlatformMeta(id) !== undefined;
}

// ── Estimation de durée ─────────────────────────────────────────
/** Surcoût fixe par déploiement (auth + création + landing + revue), en s. */
const BASE_OVERHEAD_S = 30;
/** Coût moyen d'upload d'une leçon via API, en s. */
const PER_LESSON_API_S = 8;
/** Coût moyen d'upload d'une leçon via navigateur headless (plus lent), en s. */
const PER_LESSON_BROWSER_S = 20;
/** Nombre maximal de déploiements exécutés simultanément (concurrence worker). */
export const MAX_CONCURRENT_DEPLOYMENTS = 2;

/** Estimation (secondes) de la durée d'un déploiement pour N leçons. */
export function estimatePlatformSeconds(platformId: string, lessonCount: number): number {
  const caps = getCapabilities(platformId);
  const perLesson = caps.needsBrowser ? PER_LESSON_BROWSER_S : PER_LESSON_API_S;
  return BASE_OVERHEAD_S + Math.max(0, lessonCount) * perLesson;
}

/**
 * Estimation de la durée TOTALE (secondes) d'un lot multi-plateformes, en tenant
 * compte de la concurrence : au plus MAX_CONCURRENT_DEPLOYMENTS jobs en parallèle.
 * Approximation par ordonnancement « plus long d'abord » sur `concurrency` voies.
 */
export function estimateBatchSeconds(
  platformIds: string[],
  lessonCount: number,
  concurrency: number = MAX_CONCURRENT_DEPLOYMENTS,
): number {
  const durations = platformIds
    .map((id) => estimatePlatformSeconds(id, lessonCount))
    .sort((a, b) => b - a);
  // Ordonnancement glouton : chaque durée sur la voie la moins chargée.
  const lanes = new Array<number>(Math.max(1, concurrency)).fill(0);
  for (const d of durations) {
    let min = 0;
    for (let i = 1; i < lanes.length; i += 1) {
      if (lanes[i]! < lanes[min]!) min = i;
    }
    lanes[min]! += d;
  }
  return Math.max(0, ...lanes);
}

/** Formate une durée (secondes) en libellé court français (« ~3 min »). */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} h` : `~${hours} h ${rest}`;
}
