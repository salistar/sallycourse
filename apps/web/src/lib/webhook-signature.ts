import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signature HMAC-SHA256 des webhooks sortants (Prompt 51). Logique PURE.
 *
 * Le corps envoyé est signé avec le `secret` du webhook ; le récepteur
 * recalcule la signature et la compare pour authentifier le payload. On inclut
 * un timestamp dans la base signée pour permettre une protection anti-rejeu
 * côté récepteur (fenêtre de tolérance).
 */

/** En-tête portant la signature `t=<ts>,v1=<hmac hex>`. */
export const SIGNATURE_HEADER = 'X-SallyCourse-Signature';
/** En-tête portant le nom de l'événement, pour un routage rapide côté récepteur. */
export const EVENT_HEADER = 'X-SallyCourse-Event';

/** Génère un secret de signature (32 octets hex) pour un nouveau webhook. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/** Base signée : `<timestamp>.<payload>` — lie la signature à l'instant d'envoi. */
export function signedPayload(payload: string, timestamp: number): string {
  return `${timestamp}.${payload}`;
}

/**
 * Calcule la signature HMAC-SHA256 (hex) d'un payload à un timestamp donné.
 * `payload` doit être exactement le corps JSON envoyé (même sérialisation).
 */
export function computeSignature(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  return createHmac('sha256', secret)
    .update(signedPayload(payload, timestamp), 'utf8')
    .digest('hex');
}

/** Valeur complète de l'en-tête de signature : `t=<ts>,v1=<hmac>`. */
export function buildSignatureHeader(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(payload, secret, timestamp)}`;
}

/** Parse un en-tête `t=...,v1=...` en { timestamp, signature }. */
export function parseSignatureHeader(
  header: string,
): { timestamp: number; signature: string } | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: number | undefined;
  let signature: string | undefined;
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't' && value) timestamp = Number(value);
    if (key === 'v1' && value) signature = value;
  }
  if (timestamp === undefined || Number.isNaN(timestamp) || !signature) return null;
  return { timestamp, signature };
}

/**
 * Vérifie un en-tête de signature contre un payload et un secret, en temps
 * constant. `toleranceSec` borne l'écart de timestamp accepté (anti-rejeu) ;
 * 0 ou négatif désactive le contrôle temporel.
 */
export function verifySignature(
  payload: string,
  secret: string,
  header: string,
  toleranceSec = 300,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  if (toleranceSec > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.timestamp) > toleranceSec) return false;
  }

  const expected = computeSignature(payload, secret, parsed.timestamp);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
