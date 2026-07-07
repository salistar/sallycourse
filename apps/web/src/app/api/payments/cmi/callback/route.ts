import { getCmiConfig, verifyCmiCallback, parseOrderId, isCmiApproved } from '@/lib/payments/cmi';
import { activatePlan } from '@/lib/payments/plans';
import { logger } from '@/lib/logger';

/**
 * POST /api/payments/cmi/callback — callback serveur-à-serveur de CMI après le
 * paiement 3-D Secure. CMI POST un formulaire urlencodé signé (champ `hash`).
 *
 * Séquence : parse le form → vérifie le hash (storeKey) → contrôle le statut
 * d'approbation → active le plan (idempotent, oid = clé). CMI attend une réponse
 * texte : `ACTION=POSTAUTH` valide la capture, tout autre corps annule.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Réponse texte comprise par CMI pour finaliser (POSTAUTH) ou annuler. */
function cmiResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: Request) {
  const cmi = getCmiConfig();
  if (!cmi) {
    logger.warn('CMI callback reçu mais aucune clé CMI configurée');
    return cmiResponse('FAILURE');
  }

  // CMI envoie du x-www-form-urlencoded : on aplatit en Record<string,string>.
  let params: Record<string, string>;
  try {
    const form = await request.formData();
    params = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') params[k] = v;
    }
  } catch {
    return cmiResponse('FAILURE');
  }

  // 1. Authenticité : le hash doit correspondre à la storeKey.
  if (!verifyCmiCallback(params, cmi.storeKey)) {
    logger.warn({ oid: params.oid }, 'CMI callback : signature invalide');
    return cmiResponse('FAILURE');
  }

  // 2. Statut d'approbation de la transaction.
  if (!isCmiApproved(params)) {
    logger.info({ oid: params.oid, code: params.ProcReturnCode }, 'CMI callback : paiement refusé');
    return cmiResponse('APPROVED'); // hash OK mais non approuvé : rien à capturer
  }

  // 3. Rapprochement commande → utilisateur/plan.
  const parsed = parseOrderId(params.oid ?? '');
  if (!parsed) {
    logger.warn({ oid: params.oid }, 'CMI callback : oid non reconnu');
    return cmiResponse('FAILURE');
  }

  // 4. Activation idempotente (rejouer le même oid ne double pas la période).
  const result = await activatePlan({
    userId: parsed.userId,
    plan: parsed.plan,
    provider: 'cmi',
    providerRef: params.oid,
  });

  if (!result.ok) {
    logger.error({ oid: params.oid, reason: result.reason }, 'CMI callback : activation échouée');
    return cmiResponse('FAILURE');
  }

  logger.info({ oid: params.oid, userId: parsed.userId, plan: parsed.plan }, 'CMI : plan activé');
  return cmiResponse('ACTION=POSTAUTH');
}
