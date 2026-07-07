import { NextResponse } from 'next/server';
import { connectDb, ApiKey } from '@sallycourse/db';
import { hashApiKey, looksLikeApiKey } from './api-key';

/**
 * Authentification par clé API pour l'API publique v1 (Prompt 51).
 *
 * La clé est présentée soit en `Authorization: Bearer <clé>`, soit en en-tête
 * `X-API-Key: <clé>`. On ne compare jamais la clé en clair stockée (il n'y en a
 * pas) : on hashe la clé présentée et on cherche le hash en base. Le lookup est
 * indexé (hashedKey unique), donc constant sans exposer de fuite temporelle
 * exploitable sur la valeur secrète.
 */

export interface ApiKeyUser {
  /** Id Mongo de l'utilisateur propriétaire de la clé. */
  userId: string;
  /** Id de la clé API utilisée. */
  apiKeyId: string;
}

/** Extrait la clé présentée depuis les en-têtes (Bearer ou X-API-Key). */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const key = auth.slice('Bearer '.length).trim();
    if (key) return key;
  }
  const header = request.headers.get('x-api-key');
  if (header?.trim()) return header.trim();
  return null;
}

const unauthorized = () =>
  NextResponse.json(
    { error: 'Clé API manquante ou invalide.', code: 'unauthorized' },
    { status: 401 },
  );

/**
 * Garde des Route Handlers /api/v1/* : retourne l'utilisateur porteur de la clé
 * ou une Response 401 JSON. Usage :
 *   const user = await requireApiKeyUser(request);
 *   if (user instanceof Response) return user;
 */
export async function requireApiKeyUser(
  request: Request,
): Promise<ApiKeyUser | Response> {
  const presented = extractApiKey(request);
  if (!presented || !looksLikeApiKey(presented)) return unauthorized();

  await connectDb();

  const hashed = hashApiKey(presented);
  const record = await ApiKey.findOne({ hashedKey: hashed })
    .select('_id userId')
    .lean();
  if (!record) return unauthorized();

  // Trace de dernière utilisation — best-effort, ne bloque pas la requête.
  ApiKey.updateOne({ _id: record._id }, { $set: { lastUsed: new Date() } }).catch(
    () => undefined,
  );

  return { userId: String(record.userId), apiKeyId: String(record._id) };
}
