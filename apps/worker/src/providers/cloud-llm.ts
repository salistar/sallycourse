// Catalogue de providers LLM CLOUD (Prompt 151 étendu) — tous OpenAI-compatibles
// (endpoint /chat/completions, JSON mode). Objectif : donner à l'auteur le CHOIX
// du provider à la création du cours, avec un ordre par défaut OPTIMISÉ COÛT
// (gratuit d'abord). Chaque provider est activé UNIQUEMENT si sa clé est
// présente en environnement. Anthropic (SDK) et Ollama (local) restent gérés
// à part (lib/claude.ts, providers/ollama-provider.ts) — ici, la famille
// OpenAI-compatible uniquement.
import { z } from 'zod';
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
import { extractJsonPayload } from '../lib/claude.js';
import { recordCloudLlmCost, type CostContext } from '../lib/cost.js';

export interface CloudLlmProvider {
  /** Identifiant stable stocké dans course.llmProvider et exposé à l'UI. */
  id: string;
  /** Libellé lisible côté produit. */
  label: string;
  /** Base OpenAI-compatible (se termine par /v1 ou équivalent). */
  baseUrl: string;
  /** Modèle par défaut (surchargeable via CLOUD_LLM_<ID>_MODEL). */
  model: string;
  /** Clé résolue depuis l'environnement (undefined = provider indisponible). */
  apiKey?: string;
  /** Gratuit / quota gratuit — priorité 0 dans l'ordre coût. */
  free: boolean;
  /** Rang de coût croissant (0 = gratuit, 1 = très bon marché, …). */
  costRank: number;
  /** Note qualité indicative (pour l'affichage), 1-5. */
  quality: number;
}

/** Définition statique du catalogue (clé/base/modèle résolus à l'appel). */
interface CatalogEntry {
  id: string;
  label: string;
  keyEnv: keyof ReturnType<typeof getConfig> & string;
  baseUrl: string | (() => string | undefined);
  model: string;
  free: boolean;
  costRank: number;
  quality: number;
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'gemini',
    label: 'Google Gemini Flash (gratuit)',
    keyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    free: true,
    costRank: 0,
    quality: 4,
  },
  {
    id: 'zhipu',
    label: 'Zhipu GLM-4.5 Flash (gratuit)',
    keyEnv: 'ZHIPU_API_KEY',
    // Host INTERNATIONAL z.ai (clé émise sur z.ai) — le host bigmodel.cn ne
    // partage pas les clés et n'a pas glm-4.5-flash. Testé 200 (2026-07).
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.5-flash',
    free: true,
    costRank: 0,
    quality: 3,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek Chat (très bon marché)',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    free: false,
    costRank: 1,
    quality: 4,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    keyEnv: 'MOONSHOT_API_KEY',
    // Host INTERNATIONAL (.ai) — la clé est émise sur platform.moonshot.ai ;
    // api.moonshot.cn renvoie 401 pour cette clé. Testé 200 (2026-07).
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'moonshot-v1-8k',
    free: false,
    costRank: 2,
    quality: 4,
  },
  {
    id: 'dashscope',
    label: 'Alibaba Qwen (DashScope)',
    keyEnv: 'DASHSCOPE_API_KEY',
    // Clé authentifiée sur le host Chine (host intl → 401). NOTE : les modèles
    // Qwen doivent être ACTIVÉS dans la console Model Studio du compte, sinon
    // 403 « Access denied » (le cascade retombe alors sur un autre provider).
    baseUrl: () => getConfig().DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    free: false,
    costRank: 2,
    quality: 4,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    keyEnv: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
    free: false,
    costRank: 3,
    quality: 4,
  },
  {
    id: 'minimax',
    label: 'MiniMax M2',
    keyEnv: 'MINIMAX_API_KEY',
    // Host INTERNATIONAL api.minimax.IO (le .com = Chine, 401 pour cette clé ;
    // l'ancien api.minimaxi.chat est déprécié). Modèle M2 (Text-01 déprécié).
    // Testé 200 (2026-07). M2 est un modèle « reasoning » (sorties <think>).
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M2',
    free: false,
    costRank: 3,
    quality: 4,
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI (Llama 3.3)',
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    baseUrl: () => {
      const acct = getConfig().CLOUDFLARE_ACCOUNT_ID;
      return acct ? `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1` : undefined;
    },
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    free: false,
    costRank: 1,
    quality: 4,
  },
];

/** Résout base URL + modèle + clé pour une entrée (surcharges .env prioritaires). */
function resolveEntry(entry: CatalogEntry): CloudLlmProvider {
  const cfg = getConfig();
  const baseRaw = typeof entry.baseUrl === 'function' ? entry.baseUrl() : entry.baseUrl;
  const base = process.env[`CLOUD_LLM_${entry.id.toUpperCase()}_BASE_URL`]?.trim() || baseRaw || '';
  const model = process.env[`CLOUD_LLM_${entry.id.toUpperCase()}_MODEL`]?.trim() || entry.model;
  const apiKey = (cfg[entry.keyEnv] as string | undefined)?.trim() || undefined;
  return {
    id: entry.id,
    label: entry.label,
    baseUrl: base.replace(/\/+$/, ''),
    model,
    apiKey,
    free: entry.free,
    costRank: entry.costRank,
    quality: entry.quality,
  };
}

/** Catalogue complet (résolu) — pour l'affichage UI (dispo ou non). */
export function cloudLlmCatalog(): CloudLlmProvider[] {
  return CATALOG.map(resolveEntry);
}

/** Providers réellement UTILISABLES (clé + base URL présentes). */
export function availableCloudLlms(): CloudLlmProvider[] {
  return cloudLlmCatalog().filter((p) => p.apiKey && p.baseUrl);
}

/**
 * Résout le provider cloud à utiliser :
 * - `id` explicite (course.llmProvider) prioritaire s'il est disponible ;
 * - sinon DEFAULT_CLOUD_LLM s'il est disponible ;
 * - sinon le MOINS CHER disponible (ordre coût puis qualité) ;
 * - null si aucun provider cloud n'a de clé.
 */
export function resolveCloudLlm(id?: string | null): CloudLlmProvider | null {
  const available = availableCloudLlms();
  if (available.length === 0) return null;
  if (id) {
    const chosen = available.find((p) => p.id === id);
    if (chosen) return chosen;
  }
  const preferred = getConfig().DEFAULT_CLOUD_LLM;
  if (preferred) {
    const def = available.find((p) => p.id === preferred);
    if (def) return def;
  }
  return [...available].sort((a, b) => a.costRank - b.costRank || b.quality - a.quality)[0]!;
}

/** Nombre maximal de tentatives (JSON invalide réinjecté au modèle). */
export const MAX_CLOUD_LLM_ATTEMPTS = 3;

/** Budget de sortie par défaut si l'appelant n'en fournit pas. */
const DEFAULT_CLOUD_MAX_TOKENS = 8192;

/** Texte + usage tokens d'un appel /chat/completions (usage absent chez certains providers → 0). */
interface ChatCompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** Raison d'arrêt normalisée ('length' = tronqué faute de tokens). */
  finishReason?: string;
}

/** Un appel /chat/completions OpenAI-compatible en mode JSON, renvoyant texte + usage. */
async function chatCompletionRaw(
  provider: CloudLlmProvider,
  system: string,
  user: string,
  temperature?: number,
  maxTokens?: number,
): Promise<ChatCompletionResult> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      // Budget de sortie explicite : sans lui, un long article pouvait dépasser
      // la limite par défaut du provider → JSON tronqué → validation en échec.
      max_tokens: maxTokens ?? DEFAULT_CLOUD_MAX_TOKENS,
      ...(temperature !== undefined ? { temperature } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`${provider.id} ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
    finishReason: body.choices?.[0]?.finish_reason,
  };
}

/**
 * Génère un JSON validé via un provider cloud OpenAI-compatible. Jette après
 * MAX_CLOUD_LLM_ATTEMPTS échecs de validation (l'appelant décide du repli).
 */
export async function callCloudLlmJson<T>(params: {
  provider: CloudLlmProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Input libre (schémas `.default()`), voir claude.ts.
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  system: string;
  user: string;
  temperature?: number;
  /** Budget de sortie (tokens) — respecte celui demandé par l'appelant. */
  maxTokens?: number;
  /** Contexte de coût — si fourni, chaque appel réel est comptabilisé (CostRecord). */
  cost?: CostContext;
}): Promise<T> {
  const { provider, schema, system, user, temperature, maxTokens, cost } = params;
  let lastIssues = '';
  for (let attempt = 1; attempt <= MAX_CLOUD_LLM_ATTEMPTS; attempt++) {
    const promptUser =
      attempt === 1
        ? user
        : `${user}\n\nTa réponse précédente ne respectait pas le schéma attendu. Erreurs :\n${lastIssues}\n` +
          `Corrige-les et réponds UNIQUEMENT avec le JSON complet corrigé.`;

    const { content: raw, tokensIn, tokensOut, finishReason } = await chatCompletionRaw(
      provider,
      system,
      promptUser,
      temperature,
      maxTokens,
    );
    // Coût de CET appel (chaque tentative consomme des tokens) — best-effort,
    // le modèle facturé porte l'id de modèle cloud (gratuit ⇒ 0 dans la grille).
    if (cost) {
      await recordCloudLlmCost(cost, provider.model, tokensIn, tokensOut).catch(() => undefined);
    }
    // Réponse tronquée faute de tokens : le JSON est forcément incomplet. Inutile
    // de tenter un parse (qui échouerait avec un message trompeur) — on remonte
    // une erreur claire pour que l'appelant élargisse le budget ou bascule.
    if (finishReason === 'length') {
      lastIssues = `réponse tronquée (finish_reason=length) — budget de sortie (${maxTokens ?? DEFAULT_CLOUD_MAX_TOKENS} tokens) insuffisant`;
      logger.warn({ provider: provider.id, attempt, issues: lastIssues }, 'callCloudLlmJson : réponse tronquée');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonPayload(raw));
    } catch (err) {
      lastIssues = `JSON invalide : ${(err as Error).message}`;
      logger.warn({ provider: provider.id, attempt, issues: lastIssues }, 'callCloudLlmJson : parsing JSON échoué');
      continue;
    }
    const validated = schema.safeParse(parsed);
    if (validated.success) return validated.data;
    lastIssues = validated.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    logger.warn({ provider: provider.id, attempt, issues: lastIssues }, 'callCloudLlmJson : validation Zod échouée');
  }
  throw new Error(`${provider.id} : JSON non conforme après ${MAX_CLOUD_LLM_ATTEMPTS} tentatives — ${lastIssues.slice(0, 300)}`);
}
