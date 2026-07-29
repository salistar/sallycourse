// Relevé du crédit/état des providers LLM+Modal (dashboard super-admin
// /admin/ops, 2026-07-29). Deux familles de sonde :
//  - « solde » : le provider expose une vraie API de solde (DeepSeek,
//    Moonshot) → chiffre exact.
//  - « sonde live » : pas d'API de solde publique (Anthropic, Gemini,
//    Cloudflare, Zhipu, OpenAI) → appel minimal (1 token / liste de modèles,
//    gratuit ou quasi-gratuit) pour distinguer "opérationnel" de "épuisé"
//    (crédit à sec, quota dépassé) — même symptôme que celui trouvé
//    manuellement pendant l'audit (Anthropic 400 "credit balance too low",
//    Gemini 429 "prepayment").
// Résultats mis en cache Redis 15 min : on ne sonde pas les providers à
// chaque chargement de page (coût + latence), et un opérateur qui recharge
// la page n'attend pas 8 appels réseau séquentiels.
import { Redis } from 'ioredis';
import { getConfig } from '@sallycourse/shared';
import { logger } from '@/lib/logger';

export type CreditStatus = 'ok' | 'low' | 'exhausted' | 'unknown' | 'not_configured';

export interface ProviderCredit {
  id: string;
  label: string;
  status: CreditStatus;
  /** Solde exact en USD si l'API le fournit (DeepSeek, Moonshot). */
  balanceUsd?: number;
  /** Détail lisible (raison de l'état, ou lien vers le dashboard externe). */
  detail: string;
  checkedAt: string;
}

const CACHE_PREFIX = 'ops:credit:';
const CACHE_TTL_SEC = 900; // 15 min

interface Store {
  redis?: Redis;
}
const globalWithRedis = globalThis as typeof globalThis & { __sallycourseOpsRedis?: Store };
const store: Store = (globalWithRedis.__sallycourseOpsRedis ??= {});

function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return store.redis;
}

async function cached(id: string, compute: () => Promise<ProviderCredit>): Promise<ProviderCredit> {
  const key = `${CACHE_PREFIX}${id}`;
  try {
    const raw = await getRedis().get(key);
    if (raw) return JSON.parse(raw) as ProviderCredit;
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : lecture cache crédit impossible');
  }
  const result = await compute();
  try {
    await getRedis().set(key, JSON.stringify(result), 'EX', CACHE_TTL_SEC);
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : écriture cache crédit impossible');
  }
  return result;
}

const PROBE_TIMEOUT_MS = 8000;

function now(): string {
  return new Date().toISOString();
}

// ── Familles « solde exact » ──────────────────────────────────────────

async function probeDeepseek(): Promise<ProviderCredit> {
  const id = 'deepseek';
  const label = 'DeepSeek';
  const key = getConfig().DEEPSEEK_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { id, label, status: 'unknown', detail: `API solde en erreur (${res.status})`, checkedAt: now() };
    }
    const data = (await res.json()) as {
      balance_infos?: { total_balance?: string }[];
    };
    const balanceUsd = Number.parseFloat(data.balance_infos?.[0]?.total_balance ?? '0');
    const status: CreditStatus = balanceUsd <= 0 ? 'exhausted' : balanceUsd < 2 ? 'low' : 'ok';
    return { id, label, status, balanceUsd, detail: `${balanceUsd.toFixed(2)} $ disponibles`, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

async function probeMoonshot(): Promise<ProviderCredit> {
  const id = 'moonshot';
  const label = 'Moonshot Kimi';
  const key = getConfig().MOONSHOT_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    const res = await fetch('https://api.moonshot.ai/v1/users/me/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { id, label, status: 'unknown', detail: `API solde en erreur (${res.status})`, checkedAt: now() };
    }
    const data = (await res.json()) as { data?: { available_balance?: number } };
    const balanceUsd = data.data?.available_balance ?? 0;
    const status: CreditStatus = balanceUsd <= 0 ? 'exhausted' : balanceUsd < 2 ? 'low' : 'ok';
    return { id, label, status, balanceUsd, detail: `${balanceUsd.toFixed(2)} $ disponibles`, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

// ── Famille « sonde live » (pas d'API de solde publique) ──────────────

/** Classifie une réponse HTTP en statut de crédit, à partir des motifs observés en audit. */
function classifyHttpStatus(status: number, bodySnippet: string): { status: CreditStatus; detail: string } {
  if (status === 200) return { status: 'ok', detail: 'Opérationnel' };
  if (status === 400 && /credit|balance|insufficient/i.test(bodySnippet)) {
    return { status: 'exhausted', detail: 'Crédit épuisé' };
  }
  if (status === 402) return { status: 'exhausted', detail: 'Paiement requis (crédit épuisé)' };
  if (status === 429) return { status: 'exhausted', detail: 'Quota dépassé (429)' };
  if (status === 401 || status === 403) return { status: 'unknown', detail: `Clé invalide ou révoquée (${status})` };
  return { status: 'unknown', detail: `Réponse inattendue (${status})` };
}

async function probeAnthropic(): Promise<ProviderCredit> {
  const id = 'anthropic';
  const label = 'Anthropic Claude';
  const key = getConfig().ANTHROPIC_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await res.text().catch(() => '');
    const { status, detail } = classifyHttpStatus(res.status, body);
    return { id, label, status, detail, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

async function probeGemini(): Promise<ProviderCredit> {
  const id = 'gemini';
  const label = 'Google Gemini';
  const key = getConfig().GEMINI_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    const body = await res.text().catch(() => '');
    const { status, detail } = classifyHttpStatus(res.status, body);
    return { id, label, status, detail, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

async function probeCloudflare(): Promise<ProviderCredit> {
  const id = 'cloudflare';
  const label = 'Cloudflare Workers AI';
  const cfg = getConfig();
  if (!cfg.CLOUDFLARE_API_TOKEN || !cfg.CLOUDFLARE_ACCOUNT_ID) {
    return { id, label, status: 'not_configured', detail: 'Clé/compte absent', checkedAt: now() };
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfg.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=1`,
      { headers: { Authorization: `Bearer ${cfg.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
    const body = await res.text().catch(() => '');
    const { status, detail } = classifyHttpStatus(res.status, body);
    return { id, label, status, detail: status === 'ok' ? 'Quota gratuit/jour actif' : detail, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

async function probeZhipu(): Promise<ProviderCredit> {
  const id = 'zhipu';
  const label = 'Zhipu GLM';
  const key = getConfig().ZHIPU_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    const res = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'glm-4.5-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await res.text().catch(() => '');
    const { status, detail } = classifyHttpStatus(res.status, body);
    return { id, label, status, detail: status === 'ok' ? 'Gratuit, opérationnel' : detail, checkedAt: now() };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

async function probeOpenAi(): Promise<ProviderCredit> {
  const id = 'openai';
  const label = 'OpenAI';
  const key = getConfig().OPENAI_API_KEY;
  if (!key) return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  try {
    // Liste de modèles : gratuite, confirme seulement la validité de la clé
    // (OpenAI n'expose pas de signal d'épuisement de crédit sur cet endpoint —
    // vérifier le solde exact sur platform.openai.com/usage).
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      return { id, label, status: 'unknown', detail: 'Clé invalide ou révoquée', checkedAt: now() };
    }
    return {
      id,
      label,
      status: res.ok ? 'unknown' : 'unknown',
      detail: res.ok ? 'Clé valide — solde exact sur platform.openai.com/usage' : `Réponse inattendue (${res.status})`,
      checkedAt: now(),
    };
  } catch (err) {
    logger.warn({ err, id }, 'ops admin : sonde provider injoignable');
    return { id, label, status: 'unknown', detail: 'Injoignable', checkedAt: now() };
  }
}

function probeModal(): ProviderCredit {
  const id = 'modal';
  const label = 'Modal (GPU médias)';
  // MODAL_KEY/MODAL_SECRET ne passent PAS par le schéma zod partagé (comme
  // dans modal-tts-provider.ts, seule référence existante) — lus directement.
  if (!process.env.MODAL_KEY || !process.env.MODAL_SECRET) {
    return { id, label, status: 'not_configured', detail: 'Clé absente', checkedAt: now() };
  }
  // Modal n'expose pas d'API de solde publique — consommation suivie côté
  // interne via CostRecord (section « Modal » de cette page) ; le solde exact
  // reste sur modal.com/settings/usage.
  return { id, label, status: 'unknown', detail: 'Voir modal.com/settings/usage (pas d\'API de solde)', checkedAt: now() };
}

/** Sonde tous les providers (avec cache Redis 15 min chacun), en parallèle. */
export async function fetchAllProviderCredits(): Promise<ProviderCredit[]> {
  const results = await Promise.all([
    cached('deepseek', probeDeepseek),
    cached('moonshot', probeMoonshot),
    cached('anthropic', probeAnthropic),
    cached('gemini', probeGemini),
    cached('cloudflare', probeCloudflare),
    cached('zhipu', probeZhipu),
    cached('openai', probeOpenAi),
    Promise.resolve(probeModal()),
  ]);
  return results;
}
