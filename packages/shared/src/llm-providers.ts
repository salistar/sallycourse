// Métadonnées d'affichage des providers LLM (Prompt 151+) — partagées entre le
// worker (providers/cloud-llm.ts, qui y ajoute base URL/modèle/clé) et le
// formulaire de création web (sélecteur « Moteur de rédaction »). AUCUN secret
// ici : uniquement l'identité et le libellé, pour que l'UI et le worker ne
// divergent jamais. `available` est renseigné côté serveur au besoin.

export interface LlmProviderMeta {
  /** Id stable stocké dans course.llmProvider. */
  id: string;
  /** Libellé affiché dans le sélecteur. */
  label: string;
  /** Gratuit / quota gratuit (0 coût variable). */
  free: boolean;
  /** Note qualité indicative (1-5) pour l'ordre d'affichage. */
  quality: number;
}

/**
 * Catalogue exposé à l'UI. 'auto' = cascade coût automatique (défaut). Les ids
 * de type cloud DOIVENT correspondre au CATALOG de worker/providers/cloud-llm.ts.
 * 'anthropic' et 'ollama' sont des chemins spéciaux (SDK / local), pas cloud-compat.
 */
export const LLM_PROVIDER_CATALOG: LlmProviderMeta[] = [
  { id: 'auto', label: 'Auto — le moins cher disponible (recommandé)', free: true, quality: 4 },
  { id: 'gemini', label: 'Google Gemini Flash — gratuit', free: true, quality: 4 },
  { id: 'cloudflare', label: 'Cloudflare Workers AI (Llama 3.3 70B) — quota gratuit/jour', free: true, quality: 4 },
  { id: 'zhipu', label: 'Zhipu GLM-4 Flash — gratuit', free: true, quality: 3 },
  { id: 'deepseek', label: 'DeepSeek Chat — très bon marché', free: false, quality: 4 },
  { id: 'moonshot', label: 'Moonshot Kimi', free: false, quality: 4 },
  { id: 'dashscope', label: 'Alibaba Qwen (DashScope)', free: false, quality: 4 },
  { id: 'xai', label: 'xAI Grok', free: false, quality: 4 },
  { id: 'minimax', label: 'MiniMax', free: false, quality: 3 },
  { id: 'anthropic', label: 'Anthropic Claude — qualité max', free: false, quality: 5 },
  { id: 'ollama', label: 'Ollama — local (hors-ligne, gratuit)', free: true, quality: 3 },
];
