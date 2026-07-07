# Mocks des APIs payantes (dev)

Deux mécanismes complémentaires évitent de dépenser en développement.

## 1. `MOCK_PROVIDERS=true` — le chemin par défaut (aucun réseau)

Quand `MOCK_PROVIDERS=true` (ou qu'aucune clé n'est renseignée), le worker
**ne fait aucun appel réseau** :

- `src/lib/claude.ts` → renvoie directement une fixture déterministe
  (`src/lib/mock-fixtures.ts`), sans instancier le client Anthropic.
- `src/media/tts.ts` → génère un silence mp3 réaliste via ffmpeg, sans TTS.

C'est le mode recommandé pour développer le pipeline de bout en bout.

## 2. `mock-server` — pour exercer le CHEMIN RÉSEAU

Parfois on veut tester le vrai code réseau (parsing des réponses, gestion des
erreurs HTTP, cache TTS…) sans clé réelle. Le serveur de mock simule les
endpoints et se branche via des URLs de base surchargées.

### Lancer le serveur

```bash
pnpm --filter @sallycourse/worker mock-server
# → écoute sur http://localhost:4010 (surchargeable via MOCK_SERVER_PORT)
```

Endpoints simulés :

| Endpoint | Réponse |
| --- | --- |
| `POST /v1/messages` | Anthropic Messages : bloc texte contenant le JSON de fixture, choisi selon l'intention détectée dans le prompt (outline, quiz, article, TP, slides, vidéo, marketing). |
| `POST /v1/text-to-speech/:voiceId` | ElevenLabs : petit mp3 muet (`audio/mpeg`). |
| `POST /v1/audio/speech` | OpenAI TTS : petit mp3 muet. |
| `GET /health` | Sonde `{ status: "ok" }`. |

### Brancher le worker dessus

Mettre `MOCK_PROVIDERS=false`, fournir de **fausses clés** (pour passer les
gardes `if (config.XXX_API_KEY)`) et pointer les URLs de base sur le serveur :

```bash
# .env (dev réseau)
MOCK_PROVIDERS=false
ANTHROPIC_API_KEY=sk-fake-local
ELEVENLABS_API_KEY=fake-local
OPENAI_API_KEY=sk-fake-local

ANTHROPIC_BASE_URL=http://localhost:4010
ELEVENLABS_BASE_URL=http://localhost:4010
OPENAI_BASE_URL=http://localhost:4010/v1
```

Ces trois variables `*_BASE_URL` sont lues directement dans `claude.ts` et
`tts.ts` (rétrocompatibles : absentes → endpoints publics par défaut). Elles ne
font pas partie du schéma Zod et n'ont donc aucun effet en production tant
qu'elles ne sont pas définies.

> Note : le SDK Anthropic est instancié en singleton. Si vous changez
> `ANTHROPIC_BASE_URL` à chaud dans un test, appelez `resetClaudeClientForTests()`.
