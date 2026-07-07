# @sallycourse/cli

CLI officielle de SallyCourse : pilote l'API publique v1 depuis le terminal —
création de cours (génération), suivi d'état et déploiement multi-plateformes.

La commande installée s'appelle `sallycourse`.

## Configuration

Deux valeurs sont requises et peuvent venir de l'environnement ou de flags
(les flags priment) :

| Valeur          | Variable d'environnement | Flag         |
| --------------- | ------------------------ | ------------ |
| URL de base API | `SALLYCOURSE_API_URL`    | `--api-url`  |
| Clé API         | `SALLYCOURSE_API_KEY`    | `--api-key`  |

La clé API est de la forme `sk_live_...`. Elle est présentée à l'API en
`Authorization: Bearer <clé>`.

```bash
export SALLYCOURSE_API_URL="https://app.sallycourse.tld"
export SALLYCOURSE_API_KEY="sk_live_xxxxxxxx"
```

## Build

Le CLI est un package TypeScript compilé en ESM (`node dist/bin.js`).

```bash
pnpm --filter @sallycourse/cli build      # compile vers dist/
node packages/cli/dist/bin.js --help      # exécution locale
```

Après un `pnpm install` avec le bin lié, la commande `sallycourse` est
directement disponible.

## Commandes

### create — génère un ou plusieurs cours

```bash
sallycourse create "Docker pour DevOps" --level intermediate --deploy udemy,youtube --lang fr
```

| Option        | Description                                         |
| ------------- | --------------------------------------------------- |
| `--level`     | `beginner` \| `intermediate` \| `advanced` (défaut beginner) |
| `--lang`      | `fr` \| `en` \| `ar` (défaut fr)                    |
| `--deploy`    | plateformes cibles à la génération (CSV)            |
| `--sections`  | nombre approximatif de sections (3–30)              |
| `--file`      | batch : un titre par ligne                          |
| `--json`      | sortie JSON brute                                   |

#### Batch (`--file`)

Un titre par ligne. Les lignes vides et celles commençant par `#` sont ignorées.
Des surcharges par ligne se déclarent après un `|` :

```
# titres.txt
Docker pour DevOps | level=intermediate | deploy=udemy,youtube
Git de zéro à héros | lang=fr
Kubernetes avancé | level=advanced | sections=12
```

```bash
sallycourse create --file titres.txt --deploy udemy
```

Les surcharges par ligne priment sur les flags globaux.

### status — état d'un cours

```bash
sallycourse status <courseId>
sallycourse status <courseId> --json
```

Affiche le statut du cours et la liste de ses déploiements (plateforme, état,
URL publique le cas échéant).

### deploy — déploie un cours existant

```bash
sallycourse deploy <courseId> --platforms udemy,youtube --mode auto
```

| Option         | Description                                   |
| -------------- | --------------------------------------------- |
| `--platforms`  | plateformes cibles (CSV, obligatoire)         |
| `--mode`       | `auto` (défaut) \| `assisted` \| `manual`     |
| `--json`       | sortie JSON brute                             |

## Codes de sortie

- `0` — succès.
- `1` — erreur d'usage, de configuration, ou échec côté API.

En mode batch, `create` renvoie `1` uniquement si **aucun** cours n'a été créé ;
les échecs partiels sont signalés ligne par ligne sur la sortie d'erreur.

## Endpoints API consommés

| Commande | Méthode & chemin                        |
| -------- | --------------------------------------- |
| create   | `POST /api/v1/courses`                  |
| status   | `GET  /api/v1/courses/:id`              |
| deploy   | `POST /api/v1/courses/:id/deploy`       |
