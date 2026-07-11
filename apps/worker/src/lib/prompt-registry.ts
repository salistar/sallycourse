// Registre de prompts admin (Prompt 93) : chaque générateur (src/prompts/*.ts)
// garde son contenu en dur comme valeur par défaut. getActivePrompt() lit
// D'ABORD la base (PromptTemplate actif pour la clé) et ne retombe sur le
// fallback fourni par l'appelant QUE si aucune version active n'existe —
// migration non destructive, aucun câblage existant ne casse si la
// collection est vide ou inaccessible.
import { PromptTemplate } from '../shared.js';
import { logger } from '../queues/index.js';

/**
 * Clés connues du playground admin — une entrée par prompt système/utilisateur
 * exposé dans apps/worker/src/prompts/*.ts. Ajouter un générateur = ajouter sa
 * clé ici (liste affichée par la page /admin/prompts).
 */
export const KNOWN_PROMPT_KEYS = [
  'outline.system',
  'outline.user',
  'article.system',
  'article.user',
  'quiz.system',
  'quiz.user',
  'tp.system',
  'tp.user',
  'video-script.system',
  'video-script.user',
  'marketing.system',
  'marketing.user',
  'resources.system',
  'resources.user',
] as const;
export type KnownPromptKey = (typeof KNOWN_PROMPT_KEYS)[number];

/**
 * Retourne le contenu actif pour `key` : la version en base marquée
 * `isActive` si elle existe, sinon `fallbackContent` (le prompt en dur
 * existant). Toute erreur d'accès base (connexion absente, etc.) est
 * avalée — le générateur appelant continue avec son fallback, jamais
 * d'échec de génération à cause du playground.
 */
export async function getActivePrompt(key: string, fallbackContent: string): Promise<string> {
  try {
    const active = await PromptTemplate.findOne({ key, isActive: true }).sort({ version: -1 }).lean();
    if (active?.content) return active.content;
  } catch (err) {
    logger.warn({ key, err: err instanceof Error ? err.message : String(err) }, 'getActivePrompt : lecture base échouée, repli sur le fallback en dur');
  }
  return fallbackContent;
}

/**
 * Crée ou met à jour la version active d'un prompt (utilisé par la page
 * admin). Versioning simple incrémental : la nouvelle version = (max version
 * existante pour la clé) + 1 ; l'ancienne version active est désactivée
 * (jamais supprimée — historique conservé pour comparaison A/B).
 */
export async function savePromptVersion(key: string, content: string, createdBy: string): Promise<{ version: number }> {
  const last = await PromptTemplate.findOne({ key }).sort({ version: -1 }).lean();
  const nextVersion = (last?.version ?? 0) + 1;

  await PromptTemplate.updateMany({ key, isActive: true }, { $set: { isActive: false } });
  await PromptTemplate.create({ key, content, version: nextVersion, isActive: true, createdBy });

  return { version: nextVersion };
}

/** Historique complet d'une clé, du plus récent au plus ancien. */
export async function listPromptVersions(key: string) {
  return PromptTemplate.find({ key }).sort({ version: -1 }).lean();
}

/** Version précédemment active (juste avant la version active actuelle) — pour la comparaison A/B côté page. */
export async function getPreviousVersion(key: string) {
  const versions = await listPromptVersions(key);
  const activeIndex = versions.findIndex((v) => v.isActive);
  if (activeIndex === -1) return null;
  return versions[activeIndex + 1] ?? null;
}
