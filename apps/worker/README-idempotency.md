# Idempotence des étapes de génération (P69)

## Contexte

Chaque étape du pipeline (`outline-generation` → `content-generation` →
`tts-generation` → `video-render` → `subtitle-generation` /
`screenshot-capture` → `packaging` → `deployment`) tourne comme job BullMQ
indépendant. Un crash worker, un timeout, ou un redémarrage doit pouvoir
relancer le job SANS dupliquer de travail déjà fait ni sauter un item non
traité — en particulier quand un processor boucle sur PLUSIEURS items
(slides TTS, étapes de capture, leçons d'un cours) et crashe au milieu.

Ce document liste, processor par processor, le mécanisme d'idempotence en
place et ce qui a été renforcé par le Prompt 69.

## Helper générique : `src/lib/idempotency.ts`

`withCheckpoint({ jobId, steps, runStep, store, onStep })` exécute `runStep`
sur chaque élément de `steps`, dans l'ordre, en persistant un checkpoint
**après chaque item réussi** (avant de passer au suivant). Au redémarrage avec
le même `jobId` :

- les items déjà checkpointés sont **rejoués** depuis leur résultat sauvegardé
  (jamais ré-exécutés — pas de double appel payant, pas de double upload) ;
- l'item qui avait jeté (donc jamais checkpointé) est **ré-exécuté** — pas de
  saut ;
- les items suivants, jamais atteints, sont traités normalement.

Une fois tous les items traités, le checkpoint est purgé (best-effort) : la
prochaine génération complète (ex. régénération manuelle) repart propre.

Deux implémentations de `CheckpointStore` :

- `createMemoryCheckpointStore()` — en mémoire process, pour les tests (ne
  survit pas à un crash réel, jamais utilisé en production) ;
- `mongoCheckpointStore(courseId, step)` — durable, adossé à
  `GenerationJob.checkpoint` (champ `Mixed` additif, clé = `jobId` passé à
  `withCheckpoint`, généralement le `lessonId`).

Voir `src/lib/idempotency.test.ts` pour le test d'intégration de reprise
(crash simulé au milieu d'une boucle de 5 items, un ou plusieurs redémarrages
successifs, vérification qu'aucun item n'est rejoué inutilement ni sauté).

## État par processor

### Déjà idempotents avant P69 (aucun changement nécessaire)

| Processor | Mécanisme |
|---|---|
| `outline-generation` | `persistOutline` purge (`deleteMany`) puis recrée Section/Lesson à chaque exécution — un retry ne duplique jamais. Transaction Mongo si disponible, écriture séquentielle sinon. La boucle métier (validation Udemy) est bornée et sans effet de bord persistant entre tentatives. |
| `content-generation` | Une leçon = un job BullMQ (`lesson-content`), pas une boucle interne multi-items : le "chaînage séquentiel" (P19) enfile la leçon suivante via un `jobId` déterministe (`makeJobId`) + `queue.remove` avant `queue.add`, donc un retry ne crée pas de doublon de job. `finalizeCourseIfComplete` utilise un **claim atomique** (`findOneAndUpdate` sur `marketing: null`) : un seul job exécute réellement la finalisation même si plusieurs leçons terminent en même temps. |
| `video-render` | Un job = une leçon (pas de boucle multi-items). `finalizeCourseIfComplete` réutilisé (même claim atomique). Sous-titrage enfilé avec `jobId` déterministe. |
| `packaging` | Reconstruit l'archive ZIP en entier à chaque exécution à partir de l'état actuel (Mongo + S3), sans effet de bord incrémental entre deux appels : une relance produit un ZIP identique (ou à jour si le contenu a changé). Un item en échec (asset manquant) est simplement omis, pas bloquant. |
| `subtitle-generation` | Un job = une leçon. Pas de boucle multi-items côté worker (la boucle de segments est interne à faster-whisper, hors de notre contrôle). Le repli dégradé (sous-titres dérivés du script) est lui-même déterministe et rejouable. |
| `deployment` / `updates` | Idempotence déjà traitée par `lessonContentHash` (P46) : ne redéploie que les leçons dont le contenu a changé depuis la dernière version connue. |

### Renforcés par P69 (checkpoint granulaire ajouté)

| Processor | Avant | Après |
|---|---|---|
| `tts-generation` | Boucle `for` sur `script.slides` : chaque slide était synthétisée et son résultat écrit uniquement en mémoire locale (`slide.audioKey`/`audioSeconds`) ; `Lesson.script` n'était persisté qu'**une seule fois à la fin de la boucle complète**. Un crash à la slide 8/10 perdait le travail des slides 1-7 côté `Lesson.script` (même si le cache TTS storage évitait de re-payer la synthèse, rien n'était réappliqué sans reparcourir tout le script). | Chaque slide passe par `withCheckpoint` (store `mongoCheckpointStore(courseId, QUEUES.tts)`, `jobId = lessonId`). Le résultat (`audioKey`, `audioSeconds`, `provider`) est checkpointé après CHAQUE slide, et `Lesson.script` est sauvegardé **incrémentalement** à chaque slide neuve (`onStep`, `resumed=false`). Une reprise après crash rejoue les slides déjà faites (aucun re-appel TTS, aucun re-upload) et ne traite réellement que les slides restantes. |
| `screenshot-capture` | Boucle `for` sur les `specs` (étapes TP à illustrer) : chaque capture réussie/échouée était traitée localement (`uploadedKeys`/`captions`/`failed` en variables de fonction), sans checkpoint entre deux itérations. Les erreurs PAR ÉTAPE étaient déjà tolérées (try/catch interne), mais un crash DUR du worker (process tué, OOM, crash Playwright) au milieu de la boucle repartait de zéro et rouvrait Playwright sur des étapes déjà capturées et uploadées. | Boucle remplacée par `withCheckpoint` (store `mongoCheckpointStore(courseId, QUEUES.screenshot)`, `jobId = lessonId`). Chaque étape — capturée avec succès OU en échec toléré — est checkpointée (`{ ok, key?, caption? }`) avant de passer à la suivante. Une reprise après crash dur ne retraite pas les étapes déjà captées (et n'échoue pas non plus sur les étapes déjà tolérées en échec) ; elle reprend exactement à l'étape suivante. |

## Pourquoi pas `content-generation` / `packaging` en boucle checkpointée

Ces deux processors bouclent aussi sur plusieurs items (leçons/sections),
mais chaque item y est **déjà** son unité de reprise naturelle :

- `content-generation` : chaque leçon est un job BullMQ séparé (pas une boucle
  interne) — c'est BullMQ lui-même qui garantit la granularité de reprise
  (retry du job = retry de LA leçon, jamais des autres).
- `packaging` : la boucle sur sections/leçons ne fait que LIRE des assets déjà
  générés et les ajouter à un flux d'archive en cours de streaming — il n'y a
  pas d'effet de bord à "rejouer" (pas d'appel payant, pas d'upload
  intermédiaire par item), donc reconstruire l'archive en entier à chaque
  tentative est déjà la stratégie la plus simple et correcte.

`withCheckpoint` reste disponible pour tout futur processor qui introduirait
une boucle interne à effets de bord coûteux (appel API payant, upload, calcul
long) par item.
