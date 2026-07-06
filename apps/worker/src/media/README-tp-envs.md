# Environnements TP dockerisés (Prompt 22)

Conteneurs éphémères de démonstration pour illustrer les TPs techniques.
Pilotés via le **CLI docker** (`execa`), sans modifier `docker-compose`.

## Modules

- `tp-environments.ts` — cycle de vie bas niveau des conteneurs.
- `tp-step-environment.ts` — pont d'intégration avec `screenshot-capture` (P21).

## Types d'environnements — `startTpEnvironment(kind, opts)`

| kind       | image par défaut              | port interne | rôle |
|------------|-------------------------------|--------------|------|
| `terminal` | `tsl0922/ttyd:latest`         | 7681         | terminal web ttyd ; les commandes du TP sont lancées via `docker exec`, puis le rendu web ttyd est capturé |
| `vscode`   | `codercom/code-server:latest` | 8080         | code-server **sans authentification** (`--auth none`) sur port aléatoire |
| `web`      | —                             | —            | ne démarre **rien** ; renvoie l'URL fournie par le TP (`opts.url`) |

Retour : `{ url, containerId?, kind, exec(cmd), stop() }`.
Le port interne est publié sur `127.0.0.1` avec un **port hôte aléatoire**
(`-p 127.0.0.1::<port>`), lu ensuite via `docker port`.

## Réseau — isolation

Tous les conteneurs rejoignent le réseau bridge dédié **`sallycourse-tp`**
(créé à la demande, idempotent). Ce réseau est **volontairement isolé** :

- aucun service du `docker-compose` (redis, mongo, minio) n'y est rattaché ;
- un TP ne peut donc **pas atteindre les services applicatifs internes** ;
- seul un port publié sur `127.0.0.1` de l'hôte est exposé, pour la capture.

> `docker-compose` n'est **pas** modifié. Le réseau est géré à l'exécution par
> `tp-environments.ts` (`docker network create sallycourse-tp`).

## Readiness & cleanup

- **Readiness** : polling HTTP toutes les secondes jusqu'à réponse (n'importe
  quel statut) ou **timeout 60 s** (`opts.readinessTimeoutMs`).
- **Cleanup garanti** :
  - conteneurs lancés avec `--rm` ;
  - `stop()` fait `docker rm -f` (idempotent, best-effort) ;
  - en cas d'échec de readiness, le conteneur est supprimé avant de propager ;
  - **reaper** `killTpContainersOlderThan(30 min)` : supprime les conteneurs
    labellisés `sallycourse.tp=1` trop vieux (fuites, jobs tués). À appeler
    périodiquement ou au démarrage du worker.

## Intégration avec `screenshot-capture` (P21)

`resolveTpStepEnvironment(step)` applique le contrat suivant :

1. `step.screenshotSpec.url` présent → `kind='web'`, capture directe de l'URL ;
2. `step.command` sans URL → `kind='terminal'`, la commande est exécutée dans le
   conteneur (`env.exec`), puis la capture cible `env.url` (rendu ttyd) ;
3. ni commande ni URL → non illustrable via un environnement (`skipped`).

L'appelant DOIT :

```ts
const result = await resolveTpStepEnvironment(step);
if (result.skipped) {
  // logguer et passer à l'étape suivante — NE PAS échouer le job
} else {
  try {
    // capturer result.env.url (+ annotations D9)
  } finally {
    await result.env.stop(); // cleanup toujours
  }
}
```

## Docker indisponible → skip propre

`isDockerAvailable()` teste `docker info`. Si Docker ne répond pas :

- `startTpEnvironment('terminal'|'vscode')` lève `DockerUnavailableError` ;
- `resolveTpStepEnvironment` le convertit en `{ skipped:true,
  reason:'docker-unavailable' }` + **warning** dans les logs ;
- le job de capture continue sans erreur (l'illustration de l'étape est sautée).

## Prérequis d'exécution (hors code)

Les images `tsl0922/ttyd` et `codercom/code-server` doivent être disponibles
(pull automatique par `docker run` au premier usage si accès réseau). En mode
CI/offline sans Docker, tout est simplement skippé.
