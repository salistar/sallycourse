# Ajouter un adapter de déploiement

Un adapter encapsule la publication d'un cours sur une plateforme cible
(Udemy, YouTube, Gumroad, …). Le flow générique est piloté par le processor
de déploiement et par `BaseDeploymentAdapter` — un nouvel adapter n'implémente
que les spécificités de sa plateforme.

Fichiers de référence :

- Contrat : `apps/worker/src/deploy/types.ts` (`DeploymentAdapter`, `DeployContext`, `DeployStatus`)
- Classe de base : `apps/worker/src/deploy/base-adapter.ts` (`BaseDeploymentAdapter`, `withRetry`, checkpoint, log structuré, garde mock)
- Registre : `apps/worker/src/deploy/registry.ts` (`registerAdapter`, `getAdapter`, `hasAdapter`)
- **Modèle simple à suivre : `apps/worker/src/deploy/adapters/gumroad.ts`** (API REST pure, sans navigateur, sans étape de revue — le cas le plus simple du repo)
- Modèle plus complexe (navigateur Playwright + captcha + revue) : `apps/worker/src/deploy/adapters/udemy.ts`

## 1. Créer le fichier de l'adapter

Nouveau fichier `apps/worker/src/deploy/adapters/<plateforme>.ts`. Structure
minimale (inspirée de `gumroad.ts`) :

```ts
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode, ILesson } from '../shared.js';

export class MaPlateformeAdapter extends BaseDeploymentAdapter {
  platform = 'ma-plateforme'; // clé unique du registre
  capabilities = { modes: ['auto'] as DeploymentMode[], needsBrowser: false };

  async authenticate(ctx: DeployContext): Promise<void> { /* … */ }
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> { /* … */ }
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> { /* … */ }
  async setLandingPage(ctx: DeployContext): Promise<void> { /* … */ }
  async submitForReview(ctx: DeployContext): Promise<void> { /* … */ }
  async getStatus(ctx: DeployContext): Promise<DeployStatus> { /* … */ }
}

registerAdapter(new MaPlateformeAdapter());
```

`updateLesson` est optionnelle : si non surchargée, `BaseDeploymentAdapter`
retombe automatiquement sur un ré-upload complet via `uploadLesson`.

### Points d'attention par méthode

- **`platform`** : identifiant stable, utilisé comme clé du registre et comme
  valeur `platform` sur les documents `Deployment`/`PlatformCredential`. Ne
  jamais le renommer une fois en production (casserait les déploiements
  existants).
- **`capabilities.modes`** : sous-ensemble de `DeploymentMode` (`'auto'`,
  `'assisted'`, `'manual'`). Une plateforme sans navigateur et sans étape
  sensible (ex. Gumroad) ne déclare que `['auto']`. Une plateforme nécessitant
  une intervention humaine possible (captcha, revue) déclare `assisted` en
  premier (voir `udemy.ts`).
- **`capabilities.needsBrowser`** : `true` si l'adapter pilote Playwright
  (voir `udemy.ts` pour l'usage de `Browser`/`BrowserContext`/`Page`) ; `false`
  pour un adapter purement API REST (`gumroad.ts`, `podia.ts`).
- **`authenticate`** : valide les credentials (`ctx.credentials`, déjà
  déchiffrés). Utiliser `this.guardMock(ctx, real, simulated)` pour éviter
  tout appel réseau en mode mock (`ctx.mock === true`, activé via
  `MOCK_PROVIDERS=true` ou credentials absents).
- **`createCourse`** : idempotent — vérifier `ctx.externalId` en entrée et le
  retourner tel quel si déjà défini (reprise après interruption, voir
  `gumroad.ts`).
- **`uploadLesson`** : appelée une fois par leçon, dans l'ordre de
  `ctx.lessons`. Le `checkpoint` (`ctx.checkpoint.lessonIndex`) est avancé par
  le processor après chaque succès — ne pas ré-uploader une leçon déjà
  traitée en cas de reprise.
- **`setLandingPage`** / **`submitForReview`** : certaines plateformes n'ont
  pas de revue distincte (vente directe) — voir `submitForReview` de
  `gumroad.ts` qui publie directement sans attente.
- **`getStatus`** : retourne `{ status, externalUrl?, reviewState? }`.
  `status` doit être une valeur de `DeploymentStatus` (voir
  `packages/db` — inclut au moins `pending`, `running`, `published`, `failed`,
  `paused`).

### Utilitaires hérités de `BaseDeploymentAdapter`

- `this.withRetry(fn, label)` — retry avec backoff linéaire (voir
  `retryOptions()`, surchargeable par adapter).
- `this.log(ctx, level, msg, progress?)` — log structuré pino + entrée
  `Deployment.logs` + publication de progression SSE (`ctx.publishProgress`).
  Préfixe automatiquement `[mock] ` en mode simulé.
- `this.guardMock(ctx, real, simulated)` — bascule automatique mock/réel.
- `this.saveCheckpoint(ctx, checkpoint)` — persiste le point de reprise.

### Credentials

Si la plateforme nécessite des identifiants stockés, ajouter le type dans
`CredentialKind` (`packages/db/src/models/platform-credential.ts`) — respecter
la règle du projet : édition **additive uniquement** de ce fichier partagé.
Voir `apps/worker/src/deploy/credential-select.ts` pour la résolution du bon
`PlatformCredential` selon la plateforme et le compte demandé (multi-comptes).

## 2. Enregistrer l'adapter dans le worker

L'enregistrement se fait par **effet de bord** : `registerAdapter(...)` est
appelé à l'import du module. Ajouter l'import dans
`apps/worker/src/index.ts`, à côté des adapters existants :

```ts
// Import à effet de bord : enregistre les adapters de déploiement dans le registre.
import './deploy/adapters/udemy.js';
import './deploy/adapters/podia.js';
import './deploy/adapters/gumroad.js';
import './deploy/adapters/skillshare.js';
import './deploy/adapters/lms.js';
import './deploy/adapters/youtube.js';
import './deploy/adapters/moodle.js';
import './deploy/adapters/teachable.js';
import './deploy/adapters/thinkific.js';
import './deploy/adapters/ma-plateforme.js'; // ← nouvel adapter
```

Édition **additive uniquement** de ce fichier (ne pas toucher aux autres
imports/branchements existants — plusieurs agents travaillent en parallèle sur
`worker/src/index.ts`).

Le processor de déploiement résout ensuite l'adapter via
`getAdapter(platform)` (`deploy/registry.ts`) à partir du champ `platform` du
document `Deployment` — aucun autre branchement n'est nécessaire.

## 3. Référencer la plateforme côté web (si applicable)

Si la plateforme doit apparaître dans le formulaire de sélection ou les écrans
de gestion de credentials du dashboard, vérifier les listes de plateformes
côté `apps/web` (formulaires de création de déploiement, page credentials) et
les étendre en cohérence avec le nom `platform` choisi. Ce prompt ne couvre
que le worker ; grep `'gumroad'` ou `'udemy'` dans `apps/web/src` pour repérer
tous les points à mettre à jour si le nouvel adapter doit être sélectionnable
depuis l'UI.

## 4. Tests attendus

Suivre le pattern des tests existants (`gumroad.ts` n'a pas encore de test
dédié dans le repo ; s'inspirer de `lms.test.ts`, `skillshare.test.ts`,
`udemy.test.ts` pour la structure). Fichier `apps/worker/src/deploy/adapters/<plateforme>.test.ts` :

1. **Enregistrement** : l'adapter est bien résolu par le registre.
   ```ts
   expect(hasAdapter('ma-plateforme')).toBe(true);
   expect(getAdapter('ma-plateforme')).toBeInstanceOf(MaPlateformeAdapter);
   ```
2. **Capacités** : `capabilities.modes` et `capabilities.needsBrowser`
   correspondent à ce qui est déclaré.
3. **Flow complet en mode mock** : construire un `DeployContext` minimal
   (`mock: true`, `logger` avec `vi.fn()`, `deployment` factice avec `save:
   vi.fn()`, voir le helper `mockCtx()` de `lms.test.ts`) et vérifier que
   `authenticate` → `createCourse` → `uploadLesson` (pour chaque leçon) →
   `setLandingPage` → `submitForReview` → `getStatus` s'exécutent **sans appel
   réseau réel** (pas de `fetch` intercepté, pas de `page.goto`).
4. **Idempotence de `createCourse`** : appeler deux fois avec un
   `ctx.externalId` déjà renseigné et vérifier qu'aucun nouvel appel réseau
   n'est déclenché (retourne l'`externalId` existant).
5. **Cas d'erreur spécifiques** : si la plateforme a des erreurs typées (à la
   manière de `UdemyCaptchaError`/`UdemySessionExpiredError` dans
   `udemy.ts`), tester qu'elles sont bien levées et que le statut `Deployment`
   correspondant (ex. `paused`) est appliqué.
6. Les mocks réseau réels (fetch intercepté, Playwright piloté) sont testés
   au niveau de fonctions utilitaires isolées si besoin (voir
   `youtube-helpers.test.ts`, `lesson-transforms.test.ts`) plutôt que dans le
   test de l'adapter complet, pour rester rapide et déterministe.

Lancer les tests du worker :

```bash
cd apps/worker && npx vitest run src/deploy/adapters/<plateforme>.test.ts
```

## 5. Vérification finale

```bash
cd apps/worker && npx tsc --noEmit
```

Corriger uniquement les erreurs introduites par le nouvel adapter — ne pas
modifier les autres adapters ni les fichiers partagés au-delà des ajouts
additifs décrits ci-dessus (`registerAdapter`, `CredentialKind` si
nécessaire, import effet de bord dans `index.ts`).
