# Providers — stratégie open-source-first (Prompt 151)

SallyCourse abstrait chaque étape payante du pipeline de génération derrière
une interface commune (`apps/worker/src/providers/types.ts`) : `LLMProvider`,
`TTSProvider`, `ImageProvider`, `EmailProvider` (le stockage objet est déjà
couvert par `@sallycourse/shared/storage` — voir mapping dans `types.ts`, pas
de nouvelle interface pour lui).

Le choix entre l'implémentation **OSS auto-hébergée** (gratuite, service
Docker local) et l'implémentation **cloud** (payante, clé API) est décidé par
`apps/worker/src/providers/registry.ts::selectProvider(kind, ctx)`, piloté par
la variable d'environnement `PROVIDER_MODE` (`packages/shared/src/config.ts`) :

| `PROVIDER_MODE` | Comportement |
|---|---|
| `oss` | Toujours l'implémentation OSS, ignore toute clé cloud configurée. |
| `cloud` | Toujours l'implémentation cloud (retombe en mock si la clé est absente — chaque implémentation reste mock-friendly). |
| `auto` (**défaut**) | OSS par défaut ; bascule vers le cloud **seulement si** une clé cloud est configurée **ET** que le plan utilisateur la justifie (`pro`/`business` — `free` reste toujours sur l'OSS, cf. `planJustifiesCloud`). |

Tous les providers respectent la règle **MOCK-FRIENDLY** du projet : si le
service local n'est pas démarré (Ollama/Piper/Kokoro/ComfyUI down) ou qu'aucune
clé cloud n'est configurée, le pipeline ne s'arrête JAMAIS — repli vers un mode
dégradé déterministe (fixture, silence, SVG procédural, ou simple log) documenté
dans chaque fichier.

## Tableau comparatif (à compléter au fil des prompts suivants)

### LLM (génération de texte structuré : plan de cours, articles, quiz, scripts)

| Provider | Type | Qualité | Coût | Vitesse | Langues | Fichier |
|---|---|---|---|---|---|---|
| Claude (Sonnet 5) | Cloud | Très haute (référence qualité rédactionnelle) | ~3$/Mtok in, 15$/Mtok out | Rapide (API) | FR/EN/AR (excellent) | `lib/claude.ts`, wrapper `providers/llm-claude.ts` |
| Ollama (Llama 3.3 70b / Qwen2.5 72b, GPU) | OSS auto-hébergé | Haute (proche cloud sur tâches critiques avec GPU) | Gratuit (coût infra GPU) | Dépend du matériel (GPU requis pour rester raisonnable) | FR/EN correct, AR variable | `providers/ollama-provider.ts`, wrapper `providers/llm-ollama.ts` |
| Ollama (Qwen2.5 14b / Llama 3.2 8b, CPU) | OSS auto-hébergé | Correcte pour tâches simples (résumés, tags, alt-text) | Gratuit | Lent en CPU pur | FR/EN correct | `providers/ollama-provider.ts` |
| Mock (fixtures) | Local/test | N/A (déterministe, pas de génération réelle) | Gratuit | Instantané | N/A | `lib/mock-fixtures.ts` |

### TTS (synthèse vocale)

| Provider | Type | Qualité | Coût | Vitesse | Langues | Fichier |
|---|---|---|---|---|---|---|
| ElevenLabs | Cloud (**premium**, pro/business uniquement) | Très haute (voix neuronales naturelles) | ~0,00022$/caractère | Rapide (API) | FR/EN/AR (multilingual v2) | `media/tts.ts`, wrapper `providers/tts-elevenlabs.ts` |
| OpenAI TTS | Cloud (repli universel) | Haute | Tarif OpenAI TTS (`tts-1`) | Rapide (API) | FR/EN/AR correct | `media/tts.ts` (repli interne) |
| Piper | OSS auto-hébergé (**défaut plan Free**) | Correcte, voix rapide CPU | Gratuit | Très rapide (CPU) | FR/EN bons modèles officiels ; AR replié sur FR (pas de modèle stable 2026-07) | `providers/piper-provider.ts`, wrapper `providers/tts-piper.ts` |
| Kokoro (82M, Apache-2.0) | OSS auto-hébergé | Correcte, clonage de voix inclus | Gratuit (CPU, GPU optionnel) | Modérée en CPU | FR/EN ; AR replié sur EN | `providers/kokoro-provider.ts` |
| Silence (mock) | Local/test | N/A | Gratuit | Instantané | N/A | `media/tts.ts` (`synthesizeSilence`) |

### Image (couvertures, visuels marketing, illustrations de slides)

| Provider | Type | Qualité | Coût | Vitesse | Langues | Fichier |
|---|---|---|---|---|---|---|
| SVG procédural | OSS/local (**défaut**) | Correcte (composition géométrique, pas de photo-réalisme) | Gratuit | Instantané | Support RTL (arabe) natif | `packages/design/marketing-assets.ts`, wrapper `providers/image-svg.ts` |
| ComfyUI (FLUX.1-schnell / Stable Diffusion) | OSS auto-hébergé (GPU) | Haute (photo-réaliste, Prompt 154) | Gratuit (coût infra GPU) | Lente en CPU, raisonnable en GPU | N/A (génération visuelle) | `providers/comfyui-provider.ts` (Prompt 154) |
| Cloud (placeholder) | Cloud | — (aucun provider câblé) | — | — | — | `providers/image-cloud.ts` (retombe sur SVG tant qu'aucune clé n'est configurée) |

### Email transactionnel (séquences post-inscription, notifications)

Le canal effectivement utilisé par `packages/db/src/email/send.ts::sendEmail`
suit désormais explicitement `PROVIDER_MODE` (Prompt 156, voir
`resolveEmailChannel` — même règle que `selectProvider`, ré-implémentée
localement en pur car `packages/db` ne dépend pas de `apps/worker`) :
`oss` → SMTP toujours ; `cloud` → Resend si clé présente ; `auto` (défaut) →
Resend seulement si clé présente ET plan destinataire pro/business, sinon
SMTP. Référence de déploiement auto-hébergé (Stalwart/Postfix + DKIM/SPF/DMARC) :
`docs/EMAIL-SELFHOSTED.md`.

| Provider | Type | Qualité | Coût | Vitesse | Langues | Fichier |
|---|---|---|---|---|---|---|
| SMTP brut | OSS/local (**défaut**) | Correcte (dépend du relai configuré — mailpit en dev, Stalwart/Postfix en prod) | Gratuit (coût infra relai) | Rapide (connexion directe) | N/A (contenu HTML fourni par l'appelant) | `providers/email-smtp.ts`, `packages/db/src/email/send.ts` |
| Resend | Cloud | Haute (délivrabilité gérée, dashboard) | Selon plan Resend | Rapide (API) | N/A | `providers/email-resend.ts`, `packages/db/src/email/send.ts` |
| Mock (log) | Local/test | N/A | Gratuit | Instantané | N/A | Chaque wrapper (`MOCK_PROVIDERS` ou clé/URL absente) |

### Notifications push web (P156, sans Firebase)

| Provider | Type | Qualité | Coût | Vitesse | Langues | Fichier |
|---|---|---|---|---|---|---|
| Web Push natif (VAPID) | OSS/standard W3C | Haute (protocole natif Chrome/Firefox/Edge, aucun SDK tiers) | Gratuit | Rapide (POST direct vers l'endpoint FCM/Mozilla du navigateur) | N/A | `apps/web/src/lib/web-push.ts` |
| Mock (log) | Local/test | N/A | Gratuit | Instantané | N/A | `web-push.ts` (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absentes) |

## Ajouter un nouveau provider

1. Implémenter le contrat (`LLMProvider` / `TTSProvider` / `ImageProvider` /
   `EmailProvider` — `providers/types.ts`) dans un nouveau fichier
   `providers/<kind>-<nom>.ts`, en respectant le mode dégradé mock-friendly.
2. Documenter la clé de config optionnelle correspondante dans
   `packages/shared/src/config.ts` (jamais `.min(1)` sans `.optional()`).
3. Ajouter une ligne dans le tableau comparatif ci-dessus.
4. Si le provider doit devenir sélectionnable automatiquement en mode `auto`,
   étendre `registry.ts::selectProvider` (le paramètre `kind` est déjà prévu
   pour une règle spécifique par famille).
