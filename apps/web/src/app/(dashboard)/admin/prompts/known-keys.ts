// Miroir des clés connues du registre de prompts worker
// (apps/worker/src/lib/prompt-registry.ts, KNOWN_PROMPT_KEYS) — le web
// n'importe pas le worker (pattern établi, voir apps/web/src/lib/deploy-catalog.ts).
// Ajouter un générateur côté worker = ajouter sa clé ici ET là-bas.

export interface PromptKeyInfo {
  key: string;
  /** Générateur d'origine (apps/worker/src/prompts/<generator>.ts). */
  generator: string;
  /** Rôle du prompt dans l'appel Claude. */
  role: 'system' | 'user';
  label: string;
}

export const KNOWN_PROMPT_KEYS: PromptKeyInfo[] = [
  { key: 'outline.system', generator: 'outline', role: 'system', label: 'Plan de cours — système' },
  { key: 'outline.user', generator: 'outline', role: 'user', label: 'Plan de cours — utilisateur' },
  { key: 'article.system', generator: 'article', role: 'system', label: 'Article — système' },
  { key: 'article.user', generator: 'article', role: 'user', label: 'Article — utilisateur' },
  { key: 'quiz.system', generator: 'quiz', role: 'system', label: 'Quiz — système' },
  { key: 'quiz.user', generator: 'quiz', role: 'user', label: 'Quiz — utilisateur' },
  { key: 'tp.system', generator: 'tp', role: 'system', label: 'Travaux pratiques — système' },
  { key: 'tp.user', generator: 'tp', role: 'user', label: 'Travaux pratiques — utilisateur' },
  { key: 'video-script.system', generator: 'video-script', role: 'system', label: 'Script vidéo — système' },
  { key: 'video-script.user', generator: 'video-script', role: 'user', label: 'Script vidéo — utilisateur' },
  { key: 'marketing.system', generator: 'marketing', role: 'system', label: 'Marketing — système' },
  { key: 'marketing.user', generator: 'marketing', role: 'user', label: 'Marketing — utilisateur' },
  { key: 'resources.system', generator: 'resources', role: 'system', label: 'Ressources — système' },
  { key: 'resources.user', generator: 'resources', role: 'user', label: 'Ressources — utilisateur' },
];

export function findKeyInfo(key: string): PromptKeyInfo | undefined {
  return KNOWN_PROMPT_KEYS.find((k) => k.key === key);
}
