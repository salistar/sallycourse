# Intégration Zapier (Prompt 97)

SallyCourse expose une intégration compatible **Zapier REST Hook** : les
événements du cycle de vie d'un cours (Prompt 51) déclenchent un Zap, et
l'action « Créer un cours » permet de lancer une génération depuis n'importe
quel déclencheur Zapier (formulaire, CRM, Google Sheets, etc.).

Toute l'infrastructure webhook (modèle `Webhook`, signature HMAC-SHA256,
émission best-effort) est celle du Prompt 51 — voir
`packages/db/src/models/webhook.ts` et `apps/web/src/lib/deploy/webhooks.ts`.
Cette intégration n'ajoute qu'une couche de conformité au protocole REST Hook
attendu par la plateforme Zapier.

## Authentification

Toutes les routes ci-dessous utilisent l'**authentification par clé API**
existante (Prompt 51) : en-tête `Authorization: Bearer <clé>` ou
`X-API-Key: <clé>`. Générez une clé depuis **Réglages → API** dans
l'application, puis configurez-la une fois dans l'app Zapier (champ
« API Key » de l'authentification personnalisée).

## Déclencheurs (Triggers) — REST Hook standard

Zapier gère lui-même l'abonnement/désabonnement lorsque l'utilisateur active
ou désactive un Zap : il appelle automatiquement les endpoints suivants, sans
action manuelle de l'utilisateur.

### Subscribe — `POST /api/v1/zapier/hooks`

Appelé par Zapier quand l'utilisateur active un Zap sur un déclencheur donné.

**Corps de la requête :**
```json
{
  "event": "generation_complete",
  "targetUrl": "https://hooks.zapier.com/hooks/standard/xxxxx/"
}
```

`event` doit être l'une des valeurs suivantes :
- `outline_ready` — le plan du cours (sections/leçons) est généré et prêt à relire.
- `generation_complete` — le contenu complet du cours (vidéos, articles, quiz) est prêt.
- `deployed` — le cours a été déployé sur une plateforme (Udemy, YouTube, etc.).
- `review_approved` — une relecture humaine a approuvé le cours.

**Réponse (201) :**
```json
{
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "event": "generation_complete",
  "targetUrl": "https://hooks.zapier.com/hooks/standard/xxxxx/"
}
```

Zapier conserve `id` pour pouvoir se désabonner ensuite.

### Unsubscribe — `DELETE /api/v1/zapier/hooks/{id}`

Appelé par Zapier quand l'utilisateur désactive le Zap. Supprime l'abonnement
créé lors du subscribe. Idempotent : un `id` déjà supprimé renvoie `404` sans
que Zapier ne le traite comme une erreur bloquante.

**Réponse (200) :** `{ "ok": true }`

### Exemple de payload — `GET /api/v1/zapier/triggers/{event}/sample`

Appelé par Zapier lors de la configuration du Zap (dans l'éditeur), pour
déduire automatiquement les champs disponibles sans attendre un événement
réel. `{event}` est l'une des quatre valeurs ci-dessus.

**Réponse (200)** — toujours un tableau, convention Zapier :
```json
[
  {
    "event": "generation_complete",
    "timestamp": 1751362800000,
    "data": {
      "courseId": "507f1f77bcf86cd799439011",
      "title": "Introduction à la data science avec Python",
      "status": "ready",
      "lessonsCount": 34,
      "quizCount": 8,
      "durationMinutes": 245
    }
  }
]
```

### Format du payload réel envoyé au déclenchement

Identique à l'exemple, signé HMAC-SHA256 (en-tête `X-SallyCourse-Signature:
t=<timestamp>,v1=<hmac hex>`, secret propre à l'abonnement — non exposé à
Zapier après la création). En-tête `X-SallyCourse-Event` porte le nom de
l'événement pour un routage rapide.

## Action — « Créer un cours »

L'action Zapier « Créer un cours » réutilise directement l'endpoint public
existant `POST /api/v1/courses` (Prompt 51/97) — aucune route dédiée
n'est nécessaire. Mapping des champs dans l'éditeur d'action Zapier :

| Champ Zapier      | Champ API      | Requis | Notes                                              |
|--------------------|----------------|--------|-----------------------------------------------------|
| Titre du cours      | `title`        | oui    | 3 à 120 caractères                                  |
| Niveau              | `difficulty`   | non    | `beginner` (défaut) / `intermediate` / `advanced`   |
| Langue              | `locale`       | non    | `fr` (défaut), code locale supporté                 |
| Plateformes cibles  | `platforms`    | non    | tableau de slugs (`udemy`, `youtube`, …), max 9     |

**Réponse (201) :** `{ "id": "...", "title": "...", "status": "..." }` —
`id` peut être réinjecté dans une étape suivante du Zap (par ex. pour
interroger `GET /api/v1/courses/{id}` et suivre la progression).

Codes d'erreur notables : `402` (quota mensuel atteint), `401` (clé invalide),
`400` (données invalides) — voir `/api/v1/openapi` pour le contrat complet.

## Configurer une Zap (exemple)

**Déclencheur → Action, cas d'usage « publier automatiquement sur Udemy » :**

1. Déclencheur : App SallyCourse → événement `deployed`.
2. Zapier appelle `POST /api/v1/zapier/hooks` avec
   `{ "event": "deployed", "targetUrl": "<url interne Zapier>" }` lors de
   l'activation du Zap.
3. Action : Gmail (ou Slack) → envoyer une notification avec `{{title}}` et
   `{{externalUrl}}` du payload reçu.

**Déclencheur → Action, cas d'usage « créer un cours depuis Google Sheets » :**

1. Déclencheur : Google Sheets → nouvelle ligne dans une feuille de titres de
   cours à générer.
2. Action : App SallyCourse → « Créer un cours », en mappant la colonne
   « Titre » vers le champ `title`.
3. (Optionnel) Déclencheur additionnel sur `generation_complete` pour
   notifier l'équipe une fois le cours prêt.

## Tests

- `apps/web/src/app/api/v1/zapier/hooks/route.test.ts` — subscribe (création
  Webhook, validation event/targetUrl, 401) + list.
- `apps/web/src/app/api/v1/zapier/hooks/[id]/route.test.ts` — unsubscribe
  (suppression, 404 id inconnu/malformé, 401).
- `apps/web/src/lib/zapier-samples.test.ts` — format et contenu des exemples
  de payload par événement.
