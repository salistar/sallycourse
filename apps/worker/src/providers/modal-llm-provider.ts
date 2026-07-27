// Provider LLM « modal » — 3e option de moteur de rédaction, à côté d'Ollama
// (local CPU) et des providers cloud OpenAI-compatibles (cloud-llm.ts). Appelle
// l'endpoint GPU serverless vLLM (modal/vllm_llm.py, Qwen2.5-7B) avec l'auth
// proxy Modal (Modal-Key / Modal-Secret), comme les autres endpoints Modal
// (modal-tts-provider.ts). L'endpoint renvoie du TEXTE ({text}) ; on en extrait
// le JSON puis on valide contre le schéma — même contrat/robustesse que
// generateOllamaJsonDirect (extraction + retry avec réinjection des erreurs).
import { z } from 'zod';
import { extractJsonPayload } from '../lib/claude.js';
import { logger } from '../queues/index.js';

const MAX_MODAL_LLM_ATTEMPTS = 3;

/** Configuré ssi URL + tokens Modal présents. */
export function isModalLlmConfigured(): boolean {
  return Boolean(
    process.env.MODAL_LLM_URL?.trim() &&
      process.env.MODAL_KEY?.trim() &&
      process.env.MODAL_SECRET?.trim(),
  );
}

/** Appel brut à l'endpoint Modal : {system?, user, temperature} -> texte. */
async function modalLlmRaw(system: string, user: string, temperature?: number): Promise<string> {
  const url = process.env.MODAL_LLM_URL!.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Modal-Key': process.env.MODAL_KEY!.trim(),
      'Modal-Secret': process.env.MODAL_SECRET!.trim(),
    },
    body: JSON.stringify({
      system,
      user,
      temperature: temperature ?? 0.4,
      max_tokens: 6144,
    }),
    // Cold-start (chargement du modèle GPU) possible : marge large.
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Modal LLM ${res.status} : ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
}

/**
 * Génère un JSON validé via l'endpoint LLM Modal. Signature alignée sur
 * generateOllamaJsonDirect pour un branchement direct dans callClaudeJson.
 */
export async function generateModalLlmJson<T>(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Input volontairement libre, voir claude.ts.
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  system: string;
  user: string;
  temperature?: number;
}): Promise<T> {
  const { schema, user, temperature } = params;
  if (!isModalLlmConfigured()) throw new Error('Modal LLM non configuré (MODAL_LLM_URL/tokens absents)');
  // vLLM n'a pas de « format json » forcé : on insiste dans le system.
  const system = `${params.system}\n\nRéponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises Markdown.`;

  let lastIssues = '';
  for (let attempt = 1; attempt <= MAX_MODAL_LLM_ATTEMPTS; attempt++) {
    const promptUser =
      attempt === 1
        ? user
        : `${user}\n\nTa réponse précédente ne respectait pas le schéma attendu. Erreurs :\n${lastIssues}\n` +
          `Corrige ces erreurs et réponds UNIQUEMENT avec le JSON complet corrigé.`;

    const raw = await modalLlmRaw(system, promptUser, temperature);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonPayload(raw));
    } catch (err) {
      lastIssues = `JSON invalide : ${(err as Error).message}`;
      logger.warn({ attempt, issues: lastIssues }, 'generateModalLlmJson : parsing JSON échoué');
      continue;
    }

    const validated = schema.safeParse(parsedJson);
    if (validated.success) return validated.data;

    lastIssues = validated.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    logger.warn({ attempt, issues: lastIssues }, 'generateModalLlmJson : validation Zod échouée');
  }
  throw new Error(`Modal LLM : JSON non conforme après ${MAX_MODAL_LLM_ATTEMPTS} tentatives — ${lastIssues.slice(0, 300)}`);
}
