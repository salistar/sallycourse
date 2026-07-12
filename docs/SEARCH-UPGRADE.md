# Recherche full-text — Mongo `$text` vs Meilisearch (Prompt 159)

## État actuel (production, inchangé par ce document)

La recherche globale (P132) fonctionne via l'**index texte natif MongoDB**
(`$text`) sur les collections `Course`, `Section`, `Lesson`. Logique pure
(construction de requête, surlignage, extraits) dans
`apps/web/src/lib/search.ts`, route `GET /api/search` dans
`apps/web/src/app/api/search/route.ts`, index déclarés dans
`packages/db/src/models/{course,section,lesson}.ts`.

**Ce document ne change rien au code applicatif.** Il documente une option
d'amélioration future (Meilisearch, déclaré en profil docker-compose `search`,
non démarré par défaut) pour quand la recherche $text montrera ses limites.

## Comparatif

| Critère | Mongo `$text` (actuel) | Meilisearch (futur possible) |
|---|---|---|
| Infra supplémentaire | Aucune (index sur la base existante) | Service dédié (conteneur + volume) |
| Latence typique | Correcte jusqu'à quelques 100k documents | Sub-10ms même à plusieurs millions de documents (index inversé dédié) |
| Tolérance aux fautes de frappe | Non (correspondance exacte de radical/stem) | Oui, native (recherche floue, typo-tolerance configurable) |
| Recherche "as you type" / préfixe | Non adaptée (nécessite requête complète) | Native, conçue pour l'auto-complétion instantanée |
| Pertinence/scoring | `textScore` basique (fréquence de termes) | Algorithme de ranking multi-critères configurable (typo, proximité, attribut, exactitude, tri custom) |
| Facettes / filtres combinés | Manuel (agrégation Mongo) | Natif (`facets`, filtres booléens performants) |
| Support arabe | Dépend du stemmer Mongo configuré (`default_language`), résultats inégaux sur les formes fléchies arabes | Tokenisation Unicode-aware native, gère correctement les scripts non-latins (arabe compris) sans plugin ; `stopWords`/`synonyms` configurables par langue (voir § dédié) |
| Coût opérationnel | Nul (déjà dans Mongo) | Un service de plus à superviser/sauvegarder (volume `meilisearch-data`) |
| Cohérence des données | Immédiate (même base) | Nécessite une synchronisation (webhook/job d'indexation à chaque écriture) |
| Auto-hébergeable / licence | Oui (inclus MongoDB) | Oui — Meilisearch est OSS (licence MIT), conforme à la stratégie open-source-first du projet (P151) |

## Quand migrer ?

Signaux qui justifieraient de basculer tout ou partie de la recherche vers
Meilisearch :
- Le volume de contenus (cours/sections/leçons) par tenant dépasse ce que
  `$text` traite confortablement (latence perçue en dégradation).
- Le besoin d'une recherche "instantanée" (résultats à chaque frappe, pas
  seulement après soumission) devient un requis produit.
- Le besoin de tolérance aux fautes de frappe (utilisateurs mobiles, clavier
  arabe/français mixte) devient une demande récurrente.
- Le besoin de facettes (filtrer par plateforme, langue, niveau, statut) en
  plus du texte libre.

Tant qu'aucun de ces signaux n'est confirmé par l'usage réel, **`$text` reste
le choix par défaut** : zéro infra additionnelle, zéro job de synchronisation
à maintenir.

## Plan de bascule (si décidé un jour)

1. Démarrer le service : `docker compose --profile search up -d meilisearch`.
2. Créer les index Meilisearch (`courses`, `sections`, `lessons`) avec les
   attributs de recherche/tri correspondant aux champs actuellement indexés
   par `$text` (titre, description, contenu).
3. Ajouter un job d'indexation (worker BullMQ, cf. `apps/worker/src/lib/queues.ts`)
   déclenché à la création/mise à jour d'un cours/section/leçon — écriture
   asynchrone vers Meilisearch en plus de Mongo (pas de remplacement direct,
   double écriture le temps de valider la bascule).
4. Basculer `apps/web/src/lib/search.ts` (et la route `/api/search`) derrière
   un flag (`SEARCH_PROVIDER=mongo|meilisearch`, à ajouter dans
   `packages/shared/src/config.ts` le jour venu) pour permettre un rollback
   instantané.
5. Une fois validé en production, envisager de retirer les index `$text`
   Mongo (optionnel — ils peuvent rester en repli).

### Support arabe — configuration recommandée (si bascule)

- Activer les `stopWords` arabes standard (ex: و، من، في، على…) pour éviter
  que des mots grammaticaux ne pèsent sur le ranking.
- Configurer `synonyms` pour les variantes courantes de translittération
  (ex: cours/دورة selon les métadonnées bilingues du catalogue).
- Vérifier `rankingRules` avec des jeux de requêtes arabes réels (formes
  définies/indéfinies, pluriels irréguliers) avant bascule en production.

## Variables d'environnement (si le profil `search` est démarré)

| Variable | Rôle | Obligatoire |
|---|---|---|
| `MEILI_MASTER_KEY` | Clé d'API du service Meilisearch | Non (défaut dev fourni dans `docker-compose.yml`, à changer en prod) |
| `MEILI_ENV` | `development` (API non authentifiée en clair sur le dashboard) ou `production` | Non (défaut `development`) |

Ces variables ne sont **pas** ajoutées à `packages/shared/src/config.ts` tant
que le code applicatif ne consomme pas Meilisearch — elles ne concernent que
le service docker-compose lui-même.
