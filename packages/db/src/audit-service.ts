// Les @ts-ignore TS6059 neutralisent le diagnostic de programme quand ce service
// est consommé en source par le worker (tsconfig NodeNext, rootDir=src) ; sans
// effet sur le typage ni l'exécution (voir apps/worker/src/shared.ts).
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { connectDb } from './connect.js';
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { AuditLog } from './models/audit-log.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { recordAudit as recordAuditPure, type AuditEntryInput } from '@sallycourse/shared/audit.js';

// Point d'entrée unique pour journaliser une action sensible (Prompt 149),
// appelé aux points identifiés : login/register, changement/suppression de
// credentials plateforme (P32), déploiement (P44), suppression de cours,
// accès admin aux pages /admin/*. BEST-EFFORT : ne jette jamais, une panne
// du journal d'audit ne doit jamais bloquer l'action métier principale (voir
// packages/shared/src/audit.ts pour la garantie + les tests purs).

/**
 * Enregistre une entrée d'audit en base. Connecte Mongo si besoin puis délègue
 * à AuditLog.create via le writer injecté dans recordAudit (packages/shared) —
 * ce wrapper est le SEUL point qui écrit réellement dans la collection
 * (hors purge par rétention, voir apps/worker/src/lib/audit-retention.ts).
 */
export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  await recordAuditPure(entry, async (full) => {
    await connectDb();
    return AuditLog.create(full);
  });
}
