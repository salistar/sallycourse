// Priorité BullMQ par plan (P73) — ré-exporte l'implémentation partagée
// (packages/shared/src/constants.ts) pour que web et worker restent alignés
// sur UNE SEULE définition. BullMQ trie par `priority` ASCENDANT (plus petit
// nombre = traité en premier) : business=1, pro=5, free=10.
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
export { priorityForPlan, PLAN_QUEUE_PRIORITY } from '@sallycourse/shared';
