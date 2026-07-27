# SallyCourse — Rapport consolidé : stack IA pour générer des cours vidéo réalistes (FR / EN / AR)

*Synthèse des 4 recherches (Modal.com, Cloudflare Workers AI, Voix TTS open-source, Architecture screencast). Priorités : coût optimisé, qualité réaliste, trilingue FR/EN/AR. Toutes les licences ont été vérifiées à la source. État mi-2026.*

---

## 0. Résumé exécutif — les deux modèles de déploiement et la stack cible

SallyCourse peut s'appuyer sur **deux plans complémentaires**, à combiner selon le poste :

- **Cloudflare Workers AI (API managée, facturée en "Neurons", edge)** : idéal pour le **texte des cours (LLM)**, le **TTS de volume multilingue (MeloTTS, dont FR)**, les **vignettes (FLUX-1 Schnell)**, la **transcription (Whisper)** et le **RAG (BGE-M3 + Vectorize)**. Zéro infra à gérer, 10 000 Neurons/jour gratuits.
- **Modal.com (compute GPU à la seconde, self-host)** : indispensable pour ce que Cloudflare ne propose pas — **avatars talking-head (lip-sync)**, **TTS premium/clonage (Chatterbox)**, **vidéo B-roll (LTX-Video, Wan 2.2)**, **images premium**. Facturation à la seconde, autoscale à zéro, 30 $/mois de compute gratuit.
- **Architecture screencast (Remotion / ffmpeg / OBS)** : la couche d'assemblage qui compose capture + overlays + narration synchronisée en vidéo finale.

**Stack cible recommandée (100 % commercialement "safe", coût mini) :**

| Brique | Choix par défaut | Où le faire tourner | Licence |
|---|---|---|---|
| Texte des cours (LLM) | Llama 3.3 70B fp8-fast + Llama 3.1 8B (tâches légères) + Qwen 2.5 Coder 32B (TP/code) | Cloudflare Workers AI | Llama / Apache |
| Narration de volume (FR/EN) | MeloTTS (`lang='fr'`) ou Kokoro-82M | Cloudflare / Modal | MIT / Apache 2.0 |
| Narration premium + clonage (FR/EN/AR) | Chatterbox Multilingual | Modal | MIT |
| Narration arabe (licence propre) | SILMA TTS v1 ou Piper `ar_JO-kareem` | Modal / self-host | à confirmer / MIT |
| Avatar "prof" (lip-sync) | MuseTalk (défaut) + LatentSync 1.6 (premium) | Modal | MIT / Apache 2.0 |
| Slides / illustrations | FLUX.1 [schnell] ou SDXL | Cloudflare / Modal | Apache 2.0 / OpenRAIL++-M |
| B-roll vidéo | LTX-Video (rapide) ou Wan 2.2 (100 % Apache) | Modal | LTXV Open Weights / Apache 2.0 |
| Transcription (audio importé) | Whisper Large V3 Turbo | Cloudflare | Apache 2.0 |
| RAG / recherche sémantique | BGE-M3 + Vectorize (+ reranker) | Cloudflare | MIT |
| Assemblage vidéo | Remotion (défaut) + ffmpeg (mux) | Serveur Linux / Lambda | — |

**Les 7 pièges de licence à ne jamais oublier** (détail §10) :
1. **XTTS-v2 (CPML) et F5-TTS (poids CC-BY-NC) = NON-COMMERCIAL** — pourtant les plus cités en tuto clonage.
2. **FLUX.1 [dev] = NON-COMMERCIAL** ; seul **[schnell]** est Apache 2.0.
3. **HunyuanVideo = interdit UE / UK / Corée du Sud** — rédhibitoire pour France/Maroc.
4. **LTX-Video** : gratuit commercial seulement **si < 10 M$ ARR**.
5. **LivePortrait (MIT)** : remplacer les modèles **InsightFace** (non-commerciaux).
6. **Orpheus (Apache 2.0)** : respecter en plus la licence **Llama-3.2** des poids de base.
7. **Edge-TTS (`edge-tts`) = zone grise juridique** — ne pas en dépendre en prod payante ; basculer sur **Azure AI Speech** officiel.

---

## 1. Génération de texte (LLM) — Cloudflare Workers AI

**Endpoints :**
- Natif : `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/{model}`
- OpenAI-compatible (drop-in SDK OpenAI) : base URL `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` → `POST .../ai/v1/chat/completions`

| Modèle | ID `@cf/...` | Input (Neurons/M tok) | Output (Neurons/M tok) | ≈ $/M out | Licence | Usage cours |
|---|---|---|---|---|---|---|
| **Llama 3.3 70B fp8-fast** | `meta/llama-3.3-70b-instruct-fp8-fast` | 26 668 | 204 805 | ~2,25 $ | Llama (commercial < 700 M MAU) | **Plans/leçons en volume** |
| Llama 3.1 8B fp8-fast | `meta/llama-3.1-8b-instruct-fp8-fast` | 4 119 | 34 868 | ~0,38 $ | Llama | Titres, résumés, quiz |
| Llama 3.2 1B | `meta/llama-3.2-1b-instruct` | 2 457 | 18 252 | ~0,20 $ | Llama | Micro-tâches |
| Llama 3.2 3B | `meta/llama-3.2-3b-instruct` | 4 625 | 30 475 | ~0,34 $ | Llama | Tâches légères |
| Llama 3.2 11B Vision | `meta/llama-3.2-11b-vision-instruct` | 4 410 | 61 493 | ~0,68 $ | Llama | Multimodal |
| Mistral 7B | `mistral/mistral-7b-instruct-v0.2` | 10 000 | 17 300 | ~0,19 $ | Apache 2.0 | Tâches rapides pas chères |
| Mistral Small 3.1 24B | `mistralai/mistral-small-3.1-24b-instruct` | 31 876 | 50 488 | ~0,56 $ | Apache 2.0 | Qualité intermédiaire |
| **Qwen 2.5 Coder 32B** | `qwen/qwen2.5-coder-32b-instruct` | 60 000 | 90 909 | ~1,00 $ | Apache 2.0 | **TP/code (K8s, Robot FW…)** |
| Qwen QwQ 32B (raisonnement) | `qwen/qwq-32b` | 60 000 | 90 909 | ~1,00 $ | Apache 2.0 | Structuration pédagogique complexe |
| DeepSeek R1 Distill 32B | `deepseek-ai/deepseek-r1-distill-qwen-32b` | 45 170 | 443 756 | ~4,88 $ | MIT | Raisonnement long |
| Llama 4 Scout 17B | `meta/llama-4-scout-17b-16e-instruct` | — | — | — | Llama | Récent, à évaluer |
| Gemma 3 12B | `google/gemma-3-12b-it` | — | — | — | Gemma | — |
| GPT-OSS 120B | `openai/gpt-oss-120b` | — | — | — | Apache 2.0 | Open-weight OpenAI |

Modèles 2026 plus récents à confirmer live : **Gemma 4 26B** (~9 091 in / 27 273 out), **GLM-4.7-Flash** (`zhipu/glm-4.7-flash`), **Qwen 3 30B**.

Exemple SDK OpenAI (Node/TS) :
```ts
const client = new OpenAI({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1`,
});
await client.chat.completions.create({
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  messages: [{ role: "user", content: "Génère le plan d'un cours sur Kubernetes." }],
});
```

**À intégrer dans SallyCourse :** router le texte des cours vers Cloudflare via l'endpoint OpenAI-compat — Llama 3.3 70B fp8-fast (défaut qualité/prix), Llama 3.1 8B (tâches légères), Qwen 2.5 Coder 32B (TP techniques), QwQ/DeepSeek R1 (structuration complexe). Ne jamais coder en dur un ID sans le vérifier sur la page live des modèles (ils changent chaque mois).

Sources : [pricing Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [catalogue modèles](https://developers.cloudflare.com/workers-ai/models/) · [OpenAI-compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) · [changelog Workers AI](https://developers.cloudflare.com/changelog/product/workers-ai/) · [GLM-4.7-Flash](https://developers.cloudflare.com/changelog/post/2026-02-13-glm-47-flash-workers-ai/) · [costbench](https://costbench.com/software/llm-api-providers/cloudflare-workers-ai/)

---

## 2. Narration TTS — le cœur du sujet (FR / EN / AR), 3 voies

C'est la brique la plus discutée (3 rapports la couvrent). On distingue **voies managées (API)**, **self-host (Modal)** et **clonage de voix**. La licence est le critère n°1.

### 2.1 Voix "prêtes" — comparatif global

| Moteur | Licence (vérifiée) | Commercial ? | FR | EN | AR | Timestamps natifs | GPU ? | Qualité | Où |
|---|---|---|---|---|---|---|---|---|---|
| **Edge-TTS** (`edge-tts`, voix Azure) | Gratuit mais **zone grise** | **NON conseillé en prod** | Excellent | Excellent | Excellent | via SSML | Non (service en ligne) | Excellent | — |
| **Azure AI Speech** (mêmes voix, officiel) | Commercial clair (500 k car./mois gratuits) | **Oui** | Excellent | Excellent | Excellent | **WordBoundary natif** | Non | Excellent | API Azure |
| **MeloTTS** | **MIT** | **Oui** | Oui | US/UK/IN/AU | **Non** | Non (aligner) | CPU temps réel | Bonne | Cloudflare `@cf/myshell-ai/melotts` / Modal |
| **Kokoro-82M** | **Apache 2.0** | **Oui** | 1 voix (`ff_siwis`) | Nombreuses (top) | **Non** | Non (aligner) | CPU ok, ~100× temps réel GPU | Très bonne | Modal / self-host |
| **Chatterbox / Multilingual** | **MIT** | **Oui** | Oui | Oui | **Oui** (23 langues) | Non (aligner) | GPU modeste (~0,5B) | Très bonne (bat ElevenLabs 65,3 % en test aveugle) | Modal (exemple officiel `chatterbox_tts`) |
| **Piper** | **MIT** | **Oui** | Oui | Oui | Oui (`ar_JO-kareem`) | Non (aligner) | CPU | Correcte (un peu robotique) | self-host |
| **SILMA TTS v1** | "Highly permissive" (à confirmer HF) | à valider | Non | Oui (AR/EN bilingue) | **Oui (spécialisé, tashkeel)** | Non | GPU conseillé | Bonne (AR) | self-host |
| **Deepgram Aura-2** | Commercial (partenaire CF) | **Oui** | Non | Oui | Non | — | Non | Supérieure | Cloudflare `@cf/deepgram/aura-2-en` |
| **Orpheus** (3B/1B/400M/150M) | Apache 2.0 **+ Llama-3.2** | **Oui** (2 licences) | multilingue | Oui | à valider | streaming | GPU (3B lourd) | Voix humaine, émotion | Modal |
| **Dia** | Apache 2.0 | **Oui** | — | Oui (anglais seul) | Non | — | GPU | Naturel + non-verbal (rires, soupirs) | Modal (exemple dispo) |
| **Higgs Audio V2** | Apache 2.0 | **Oui** | — | Oui | — | — | GPU | Naturel + émotion, multi-speaker | Modal |
| **Sesame CSM 1B** | Apache 2.0 | **Oui** | — | Oui | — | — | GPU | Bon multi-speaker | Modal |
| **XTTS-v2** (Coqui) | **CPML** | **NON** | Oui | Oui | Oui (faible) | Non | GPU | Excellent clonage 17 langues | — (proto seulement) |
| **F5-TTS** | Code MIT / **poids CC-BY-NC** | **NON** | Oui | Oui | Oui (communautaire) | Non | GPU | Clonage haut | — (proto seulement) |

### 2.2 TTS managé sur Cloudflare (endpoint natif `/ai/run/@cf/{model}`)

| Modèle | ID | Langues | Prix | Gratuit/jour |
|---|---|---|---|---|
| **MeloTTS** | `@cf/myshell-ai/melotts` | EN, ES, **FR**, ZH, JP, KR (param `lang`, défaut `en`) | 18,63 Neurons/min audio | ~536 min/jour |
| Deepgram Aura-1 | `@cf/deepgram/aura-1` | EN (voix multiples) | 1 363,64 Neurons/1000 car. | — |
| Deepgram Aura-2 EN | `@cf/deepgram/aura-2-en` | EN | 2 727,27 Neurons/1000 car. | — |
| Deepgram Aura-2 ES | `@cf/deepgram/aura-2-es` | ES | 2 727,27 Neurons/1000 car. | — |

MeloTTS param : `text`, `lang` (`'fr'`,`'en'`,`'es'`,`'zh'`,`'jp'`,`'kr'`). **Aucune voix FR native côté Deepgram** → pour le français, MeloTTS. Le TTS/image/ASR **ne passent PAS** par l'API OpenAI-compat : utiliser l'endpoint natif `/ai/run/@cf/{model}` (ou le binding `env.AI.run()` dans un Worker).

### 2.3 Noms de voix précis (self-host / Edge / Azure)

- **Edge-TTS / Azure — FR** : `fr-FR-DeniseNeural` (F, pro), `fr-FR-HenriNeural` (M, chaleureux), `fr-FR-EloiseNeural` (F), multilingues `fr-FR-VivienneMultilingualNeural` / `fr-FR-RemyMultilingualNeural` (idéales pour code-switching FR/EN/AR).
- **Edge-TTS / Azure — EN** : `en-US-AriaNeural`, `en-US-JennyNeural`, `en-US-GuyNeural`, `en-GB-SoniaNeural`, `en-GB-RyanNeural`, `en-US-AvaMultilingualNeural`.
- **Edge-TTS / Azure — AR** : MSA `ar-SA-ZariyahNeural` (F) / `ar-SA-HamedNeural` (M, cadence broadcast) ; égyptien `ar-EG-SalmaNeural` ; golfe `ar-AE-FatimaNeural`, `ar-BH-AliNeural`. Liste complète : `edge-tts --list-voices`.
- **Kokoro-82M** (v1.0, 54 voix, ~9 langues, poids ~327 Mo, 24 kHz) — EN : `af_heart` (défaut), `af_bella`, `af_nicole`, `am_michael`, `am_adam`, `am_puck`, britanniques `bf_/bm_` ; **FR : `ff_siwis` (une seule voix)** ; **AR : non supporté nativement**.
- **Piper** (~15 M param, VITS/ONNX, 100+ voix / 30+ langues, paliers `x_low→high`) — FR : `fr_FR-siwis`, `fr_FR-upmc`, `fr_FR-tom`, `fr_FR-gilles` (medium recommandé) ; EN : `en_US-lessac`, `en_US-ryan`, `en_US-amy`, `en_US-hfc_female` ; AR : `ar_JO-kareem`. Note : dépôt `rhasspy/piper` **archivé (6 oct. 2025)** → dev continue sur **`OHF-Voice/piper1-gpl`**.

### 2.4 Le point faible : l'arabe à licence propre

Aucun moteur open-source permissif n'égale Edge/Azure en AR. Meilleurs spécialisés :
- **SILMA TTS v1** (SILMA.AI) : 150 M param, **bilingue AR/EN**, MSA, gère texte **avec/sans diacritiques (tashkeel)**, clonage instantané, ~1,9 s / 100 caractères. Licence "highly permissive" **à confirmer sur la fiche HF avant prod**.
- **Lahgtna** : dialectes (égyptien, saoudien, marocain, irakien) avec diacritiques.

### 2.5 Clonage de voix (voix de marque) — commercial sûr

| Modèle | Licence poids | Commercial ? | FR/EN/AR | Échantillon | GPU |
|---|---|---|---|---|---|
| **Chatterbox Multilingual (V3)** | **MIT** | **Oui** | AR + FR + EN (23 langues) | Clip court (zero-shot) | GPU modeste (~0,5B) |
| **OpenVoice v2** | **MIT** | **Oui** | EN/FR/ES/ZH/JA/KO — **AR non** | Court | GPU léger |
| **GPT-SoVITS** | **MIT** | **Oui** | ZH/EN/JA/KO — FR/AR faibles | 5 s zero-shot / ~1 min fine-tune | GPU |
| XTTS-v2 | CPML | **NON** | FR/EN/AR (AR faible) | 6 s | GPU |
| F5-TTS | poids CC-BY-NC | **NON** | 13 langues | ~10 s | GPU |

**Chatterbox Multilingual = le seul moteur de clonage à la fois AR/FR/EN et commercialement sûr** (MIT, 0,5B, zero-shot, watermark Perth intégré). Valider la qualité **arabe** sur textes réels (diacritiques) avant mise en avant.

### 2.6 Contrôle émotion / prosodie / vitesse

- **Chatterbox** (le plus riche en OSS) : `exaggeration` (0.0 monotone → 0.5 défaut → 1.0+ théâtral), `cfg_weight` (débit : haut = littéral, bas = expressif), `temperature` (variété).
- **Edge-TTS / Azure** : SSML `<prosody rate pitch volume>`, styles `<mstts:express-as style="cheerful/newscast/…">`.
- **XTTS-v2 / F5-TTS** : vitesse + prosodie/émotion **héritées de l'audio de référence**.
- **OpenVoice v2** : transfert explicite de style/émotion séparé de la couleur de voix.
- **Kokoro / Piper / MeloTTS** : **vitesse seulement**, pas d'émotion.

### 2.7 Timestamps pour la synchro sous-titres/karaoké

- **ElevenLabs** : endpoint **with-timestamps** → niveau **caractère** (`character_start/end_times_seconds`) ; endpoint **Forced Alignment** séparé → niveau **mot**.
- **Azure AI Speech** : **`WordBoundary` events** natifs → offset audio en HNS (**10 000 HNS = 1 ms**) + offset texte + longueur ; export **SRT** documenté ; `bookmark`/`BookmarkReached` pour marqueurs custom.
- **OpenAI TTS** : timestamps non garantis (à valider).
- **Amazon Polly** : **Speech Marks** JSON (mot/phrase). Google Cloud : solide.
- **OSS (Kokoro/Piper/Chatterbox)** : pas de timestamps natifs → **alignement forcé requis** (aeneas/WhisperX, voir §6). Perfs OSS : Kokoro ~0,08 RTF (1er audio ~90 ms), Piper ~0,03 RTF (~40 ms).

**À intégrer dans SallyCourse :** pipeline TTS à 3 étages. (1) **Volume/défaut** : MeloTTS sur Cloudflare (`lang='fr'`, économique) ou Kokoro auto-hébergé pour FR/EN. (2) **Arabe** : SILMA TTS v1 (tashkeel) ou Piper `ar_JO-kareem` en fallback. (3) **Voix de marque / clonage** : Chatterbox Multilingual sur Modal (MIT, AR/FR/EN, émotion). Exposer une **option "premium"** via Azure AI Speech (licence claire, WordBoundary natif pour la synchro). Bannir XTTS-v2, F5-TTS et la dépendance à `edge-tts` en prod payante.

Sources : [Modal Open-source TTS](https://modal.com/blog/open-source-tts) · [Chatterbox GitHub](https://github.com/resemble-ai/chatterbox) · [Chatterbox HF](https://huggingface.co/ResembleAI/chatterbox) · [Chatterbox Multilingual](https://www.resemble.ai/learn/models/chatterbox-multilingual) · [Kokoro voices](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) · [Piper voices](https://github.com/rhasspy/piper/blob/master/VOICES.md) · [MeloTTS GitHub](https://github.com/myshell-ai/MeloTTS) · [MeloTTS Cloudflare](https://developers.cloudflare.com/workers-ai/models/melotts/) · [Deepgram Aura-2 EN](https://developers.cloudflare.com/workers-ai/models/aura-2-en/) · [Aura-1](https://developers.cloudflare.com/workers-ai/models/aura-1/) · [Orpheus HF](https://huggingface.co/canopylabs/orpheus-3b-0.1-ft) · [SILMA arabe](https://silma.ai/open-source-arabic-tts-models) · [Awesome Arabic AI](https://github.com/OmarSalah26/Awesome-Arabic-AI) · [Edge-TTS](https://github.com/rany2/edge-tts) · [usage commercial Edge (zone grise)](https://learn.microsoft.com/en-us/answers/questions/5925556/commercial-use-of-edge-read-aloud-voices-via-edge) · [ElevenLabs timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) · [Azure synthèse](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis) · [XTTS/CPML](https://localaimaster.com/blog/xtts-coqui-commercial-license) · [F5-TTS](https://github.com/SWivid/F5-TTS) · [F5-TTS arabe](https://huggingface.co/IbrahimSalah/F5-TTS-Arabic) · [OpenVoice/clonage](https://www.resemble.ai/resources/best-open-source-ai-voice-cloning-tools) · [licences TTS locales](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)

---

## 3. Avatar "prof" à l'écran (talking-head / lip-sync) — Modal

C'est la brique à **fort effort d'intégration** : aucun template Modal officiel n'existe, tout est à conteneuriser (dépôt GitHub ou ComfyUI-sur-Modal).

| Modèle | Rôle | Licence (vérifiée) | Commercial ? | GPU / VRAM | Coût Modal estimé | Template Modal |
|---|---|---|---|---|---|---|
| **MuseTalk** (Tencent) | Lip-sync temps réel sur visage existant | **MIT** (code **+** poids) | **Oui, sans réserve** | A10/L40S, ~5-8 Go | ~0,03-0,05 $/min (≈ temps réel, 30+ FPS) | Aucun — à conteneuriser |
| **LatentSync 1.5/1.6** (ByteDance) | Lip-sync diffusion haute fidélité | **Apache 2.0** | **Oui** | 8 Go (v1.5) / 18 Go (v1.6) | ~0,10-0,30 $/min (diffusion, plus lent) | Aucun |
| **SadTalker** | Photo → tête parlante (mouvement 3D) | **Apache 2.0** | **Oui** | T4/A10, modeste | Faible | Aucun (dispo fal/Replicate) |
| **Hallo2** (Fudan) | Avatar audio-driven longue durée, HD | **MIT** | **Oui** | A100, lourd (diffusion) | Élevé (minutes/clip) | Aucun |
| **LivePortrait** (KwaiVGI) | Animation de portrait quasi temps réel | **MIT** (voir alerte) | **Oui MAIS** | GPU moderne, rapide | Faible | Aucun |

- **MuseTalk = meilleur rapport qualité/coût/licence** (MIT total, temps réel) → choix par défaut.
- **LatentSync 1.6** = rendu premium (diffusion HD, Apache 2.0), plus lent/coûteux.
- **LivePortrait — alerte** : code MIT, mais pour un usage commercial il faut **retirer/remplacer les modèles de détection InsightFace** (recherche non-commerciale uniquement).

**À intégrer dans SallyCourse :** c'est le **point d'ingénierie n°1** — écrire les images Modal pour MuseTalk (défaut) et LatentSync 1.6 (premium). Le reste (TTS, images, vidéo) a des exemples réutilisables. Piloter l'avatar avec la piste TTS (§2) ; réserver LatentSync au palier premium.

Sources : [MuseTalk](https://github.com/TMElyralab/MuseTalk) · [LatentSync](https://github.com/bytedance/LatentSync) · [SadTalker LICENSE](https://github.com/OpenTalker/SadTalker/blob/main/LICENSE) · [Hallo2 LICENSE](https://github.com/fudan-generative-vision/hallo2/blob/main/LICENSE) · [LivePortrait (note InsightFace)](https://huggingface.co/KwaiVGI/LivePortrait) · [comparatif lip-sync](https://lipsync.com/blog/open-source-lip-sync) · [pixazo lip-sync 2026](https://www.pixazo.ai/blog/best-open-source-ai-lip-sync-models)

---

## 4. Images pour les slides / vignettes

Disponible **à la fois** sur Cloudflare (managé) et Modal (self-host, torch.compile).

### 4.1 Cloudflare Workers AI (endpoint natif `/ai/run/@cf/{model}`)

| Modèle | ID | Prix |
|---|---|---|
| **FLUX-1 Schnell** | `@cf/black-forest-labs/flux-1-schnell` | 4,80 Neurons / tuile 512×512 (par step) |
| FLUX 2 Dev | `@cf/black-forest-labs/flux-2-dev` | 18,75 in / 37,50 out Neurons par tuile |
| SDXL Base 1.0 | `@cf/stabilityai/stable-diffusion-xl-base-1.0` | facturé steps/tuiles |
| SDXL Lightning (rapide) | `@cf/bytedance/stable-diffusion-xl-lightning` | idem |
| DreamShaper 8 LCM | `@cf/lykon/dreamshaper-8-lcm` | idem |
| Leonardo Phoenix 1.0 | `@cf/leonardo/phoenix-1.0` | 530 Neurons / tuile 512×512 |

Une image 1024×1024 ≈ 4 tuiles → ~19 Neurons/step. Gratuit : ~2 000 tuiles 512²/jour avec FLUX-1 Schnell.

### 4.2 Modal (self-host)

| Modèle | Licence (vérifiée) | Commercial ? | Qualité / vitesse | Coût Modal | Template Modal |
|---|---|---|---|---|---|
| **FLUX.1 [schnell]** (BFL) | **Apache 2.0** | **Oui** | Rapide (4 étapes), très bon | ~0,005-0,01 $/img | Officiel `flux` (torch.compile) |
| **SDXL** (Stability) | **CreativeML Open RAIL++-M** | **Oui, sans plafond** (restrictions d'usage RAIL) | Énorme écosystème LoRA | — | Officiel `text_to_image` |
| **FLUX.1 [dev]** | **FLUX.1 Dev Non-Commercial** | **NON** (licence BFL séparée) | Meilleure qualité FLUX | — | Officiel (mais licence bloquante) |
| **FLUX.1 Kontext** (édition) | dev = non-commercial ; option commerciale BFL | Selon variante | Édition/retouche de slides | Officiel `image_to_image` |

- **FLUX.1 [schnell] = défaut slides** (Apache 2.0, rapide, exemple Modal officiel).
- **SDXL** = alternative avec le plus grand écosystème LoRA (style de marque cohérent).
- **Piège FLUX.1 [dev]** : LE modèle vanté partout pour sa qualité, mais **non-commercial** → rester sur schnell ou licence BFL.

**À intégrer dans SallyCourse :** slides/vignettes via **FLUX-1 Schnell** — sur Cloudflare pour le volume edge (~2 000 tuiles/jour gratuites) et/ou sur Modal (torch.compile) pour le rendu premium. Utiliser SDXL + LoRA pour un style de marque cohérent. Ne jamais utiliser FLUX.1 [dev] sans licence commerciale BFL.

Sources : [FLUX-1 Schnell Cloudflare](https://developers.cloudflare.com/workers-ai/models/) · [FLUX schnell LICENSE](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell) · [DeepWiki licences FLUX](https://deepwiki.com/black-forest-labs/flux/5-commercial-usage-and-licensing) · [Modal FLUX.1-dev](https://modal.com/blog/how-to-run-flux1-dev-on-modal) · [SDXL LICENSE](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md) · [partner models Cloudflare](https://blog.cloudflare.com/workers-ai-partner-models/)

---

## 5. Vidéo B-roll / illustrations animées — Modal

| Modèle | Licence (vérifiée) | Commercial ? | Qualité / vitesse | Coût Modal | Template Modal |
|---|---|---|---|---|---|
| **LTX-Video** (Lightricks) | **LTXV Open Weights** | **Oui si < 10 M$ ARR** (au-delà : licence payante) ; **aucune** restriction territoriale | Très rapide : 480p 20 s en ~2 s (H100 chaud) | ~0,004 $/clip (compute chaud) | Officiel `ltx`, `image_to_video` |
| **Wan 2.2** (Alibaba) | **Apache 2.0** | **Oui, sans réserve** | T2V+I2V, 5B et 14B (MoE), 720p/24fps | Modéré-élevé | Fine-tune `music-video-gen` (Wan 2.1) |
| **Mochi-1** (Genmo, 10B) | **Apache 2.0** | **Oui** | Photoréaliste, mais **lent** | ~0,33 $/clip (H100, plusieurs min) | Officiel `mochi` |
| **HunyuanVideo** (Tencent, 13B) | Tencent Community License | **Oui SAUF UE/UK/Corée** ; licence séparée si > 100 M MAU | **Meilleure qualité** globale | Élevé | Aucun |

- **LTX-Video = défaut B-roll** (le plus rapide/moins cher, exemples officiels). Nouveauté : **Lightricks a open-sourcé LTX-2 (janv. 2026)** — poids réellement ouverts, **vidéo + audio synchronisé**, jusqu'à 4K → à surveiller pour la v2.
- **Wan 2.2 = seul choix "zéro souci" (Apache 2.0)** pour éviter tout plafond de revenus.
- **HunyuanVideo à écarter** : exclusion explicite UE/UK/Corée, quel que soit le volume — rédhibitoire pour France/Maroc.
- **Mochi** : Apache 2.0 mais trop lent (~0,33 $ et plusieurs min/clip) pour du volume.

**À intégrer dans SallyCourse :** B-roll par défaut via **LTX-Video** (exemples Modal `ltx`/`image_to_video`), tant que l'ARR < 10 M$. Basculer sur **Wan 2.2** (Apache 2.0) pour le palier premium 100 % sans plafond. Surveiller LTX-2 (audio+vidéo) pour une v2. Ne jamais utiliser HunyuanVideo (interdit UE/UK/Corée).

Sources : [Modal text-to-video](https://modal.com/blog/text-to-video-ai-article) · [exemple LTX](https://modal.com/docs/examples/ltx) · [licence LTXV Open Weights (PDF)](https://static.lightricks.com/legal/LTXV-2B-Distilled-04-25-Open-Weights-License.pdf) · [LTX-2 open weights 2026](https://www.globenewswire.com/news-release/2026/01/06/3213304/0/en/Lightricks-Open-Sources-LTX-2-the-First-Production-Ready-Audio-and-Video-Generation-Model-With-Truly-Open-Weights.html) · [HunyuanVideo LICENSE](https://huggingface.co/tencent/HunyuanVideo/blob/main/LICENSE) · [DeepWiki Hunyuan license/territoire](https://deepwiki.com/Tencent/HunyuanVideo/5-license-and-legal) · [comparatif AI Magicx 2026](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026) · [exemple Mochi](https://modal.com/docs/examples/mochi)

---

## 6. Transcription (STT) + alignement forcé

### 6.1 Speech-to-Text (Cloudflare, si audio importé)

| Modèle | ID | Prix | Notes |
|---|---|---|---|
| Whisper (base) | `@cf/openai/whisper` | 41,14 Neurons/min | Multilingue (~99 langues), transcription + traduction |
| **Whisper Large V3 Turbo** | `@cf/openai/whisper-large-v3-turbo` | 46,63 Neurons/min | Multilingue, plus précis/rapide |
| Whisper Tiny EN | `@cf/openai/whisper-tiny-en` | — | **Anglais uniquement**, léger |
| Deepgram Nova-3 | `@cf/deepgram/nova-3` | 472,73 Neurons/min | Temps réel, ~10 langues (EN, ES, FR, DE, HI, RU, PT, JA, IT, NL + variantes) |

Gratuit : ~243 min/jour (Whisper base), ~214 min/jour (V3 Turbo).

### 6.2 Alignement forcé (seulement si TTS OSS sans timestamps, ou audio importé)

| Outil | Méthode | Sorties | Notes |
|---|---|---|---|
| **Timestamps natifs TTS** | fournis par l'API | mot/caractère | **À privilégier** quand vous générez la voix (§2.7) — zéro erreur ASR |
| **aeneas** | MFCC + DTW (pas d'ASR) — aligne *texte connu* ↔ audio | SMIL, SRT, VTT, JSON, TTML, CSV | **Idéal audio importé dont vous avez le texte** ; 38 langues ; robuste au bruit ; pas de GPU |
| **WhisperX** | faster-whisper + wav2vec2 (phonèmes) | mot-niveau + diarisation | 70× temps réel (large-v2), **GPU recommandé**, modèle d'alignement spécifique à la langue ; BSD-2 |
| **Montreal Forced Aligner (MFA)** | alignement phonétique | mot/phone très précis | Le plus précis, plus lourd à installer |
| **Gentle** | Kaldi | mot | Ancien, maintenance faible |

**Règle de décision :** narration générée par vous → **timestamps TTS natifs** ; texte connu + audio tiers → **aeneas** ; audio sans texte fiable → **WhisperX** (GPU) ; précision max → **MFA**.

**À intégrer dans SallyCourse :** comme SallyCourse **écrit** ses textes, privilégier les timestamps TTS natifs (Azure WordBoundary / ElevenLabs) → **pas d'alignement forcé dans le cas nominal**. Réserver Whisper (Cloudflare, V3 Turbo) + aeneas au seul cas d'audio importé.

Sources : [Whisper Cloudflare](https://developers.cloudflare.com/workers-ai/models/whisper/) · [aeneas](https://github.com/readbeyond/aeneas) · [WhisperX](https://github.com/m-bain/whisperX) · [MFA état 2026](https://arxiv.org/pdf/2606.18466) · [WhisperX vs MFA](https://github.com/m-bain/whisperX/issues/1247)

---

## 7. RAG / recherche sémantique — Cloudflare embeddings + Vectorize

Endpoint OpenAI-compat : `POST .../ai/v1/embeddings`

| Modèle | ID | Dim. | Prix (Neurons/M tok) |
|---|---|---|---|
| BGE Small EN v1.5 | `@cf/baai/bge-small-en-v1.5` | 384 | 1 841 |
| BGE Base EN v1.5 | `@cf/baai/bge-base-en-v1.5` | 768 | 6 058 |
| BGE Large EN v1.5 | `@cf/baai/bge-large-en-v1.5` | 1024 | 18 582 |
| **BGE-M3** (multilingue) | `@cf/baai/bge-m3` | 1024 | **1 075** |
| Qwen 3 Embedding 0.6B | `@cf/qwen/qwen3-embedding-0.6b` | — | 1 075 |
| EmbeddingGemma 300M | `@cf/google/embeddinggemma-300m` | — | — |

Reranker : `@cf/baai/bge-reranker-base`. Base vectorielle : **Vectorize** (pipeline RAG 100 % edge).

**À intégrer dans SallyCourse :** pour un contenu trilingue, **BGE-M3** (multilingue, 1024 dims, le moins cher) comme défaut d'embeddings + reranker `bge-reranker-base` + Vectorize pour la recherche sur le contenu généré.

Sources : [catalogue Cloudflare](https://developers.cloudflare.com/workers-ai/models/) · [OpenAI-compat embeddings](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

---

## 8. Architecture screencast / assemblage vidéo

### 8.1 Deux décisions structurantes d'abord

1. **Reconstruit-on la scène (UI web, code, slides) ou filme-t-on une vraie appli Windows ?**
   - Scène reconstruite → **Remotion (React)**, rendu sur Linux/serverless, déterministe, scalable, sans GPU Windows → **Blueprint A (défaut recommandé).**
   - Vraie appli Windows native → **VM Windows + GPU + session graphique**, pilotée OBS/ffmpeg → **Blueprint B (plus lourd).**
2. **Le texte de narration est-il écrit (script connu) ou dérivé d'un audio existant ?** SallyCourse **génère** ses textes → **pas d'alignement forcé** dans le cas nominal (timestamps TTS natifs, §2.7).

### 8.2 Capture (Blueprint B — vraie appli)

| Outil | Mécanisme | Verdict |
|---|---|---|
| **ffmpeg `ddagrab`** | Desktop Duplication API (GPU D3D11), encodage GPU direct (`h264_nvenc`) | Meilleur choix perf Windows (4K60). Windows-only, GPU DX11, sort des D3D11 frames → `hwdownload,format=bgra` |
| ffmpeg `gdigrab` | GDI (CPU) | Fallback simple sans GPU, lent |
| **OBS Studio + obs-websocket** | Capture GPU pilotée par WebSocket | Meilleur si scènes/compositing live + contrôle distant |
| **Playwright / Puppeteer** | Enregistrement viewport navigateur (Playwright `.webm`) | Idéal si le "screen" est une page web, sans GPU, headless |
| **asciinema** (`agg`, `svg-term-cli`) | Flux texte terminal (asciicast v2/v3) | Idéal démos CLI/dev |

Détails vérifiés :
- `ddagrab` GPU : `ffmpeg -f lavfi -i ddagrab=output_idx=0:framerate=60 -vf "hwdownload,format=bgra,format=yuv420p" -c:v libx264 -preset ultrafast -crf 20 out.mp4` ; GPU pur : `ffmpeg -f lavfi -i ddagrab -c:v h264_nvenc -cq 18 out.mp4`. Options : `output_idx`, `framerate`, `draw_mouse`, `dup_frames`, `video_size`/`offset_x`/`offset_y`.
- **obs-websocket v5 intégré à OBS ≥ 28**, port **4455**, piloté par `obs-websocket-js` (Node) ou `obsws-python` (Python) ; drapeaux `--websocket_port/--websocket_password`.
- **Gotcha SaaS majeur** : capture bureau Windows (ddagrab **et** OBS) exige une **session interactive + GPU réel** — impossible en conteneur Windows headless standard. → **VM Windows dédiée avec autologon + GPU** (Azure série NV, AWS G4).

### 8.3 Overlay texte / annotations

| Outil | Techno | Quand |
|---|---|---|
| **Remotion** | React/TSX, timeline déclarative | Overlays animés data-driven, sous-titres karaoké, lower-thirds, callouts, zoom/pan ; `@remotion/captions` consomme des timestamps mot-niveau (karaoké ~30 ms) |
| MoviePy | Python | Pipeline batch Python (`TextClip`) ; perfs faibles sur gros fichiers |
| ffmpeg `drawtext` | filtre CLI | Texte simple "burn-in" (typewriter, fade, lower-third, `enable='between(t,a,b)'`) ; échappement pénible, pas de wrap auto |
| ffmpeg `ass`/`subtitles` | SubStation Alpha | Sous-titres stylés + karaoké (`\k`,`\kf`), `-vf "ass=fichier.ass"` |
| Motion Canvas | TypeScript | Diagrammes/annotations animés "explainer" |

### 8.4 Assemblage final

- **Blueprint A** : Remotion compose UI + overlays + captions + piste audio TTS en une timeline React → **rendu en une passe** (Chrome Headless Shell) → mp4. Pas de mux manuel.
- **Blueprint B** : `ffmpeg` (ou `fluent-ffmpeg`/`ffmpeg-python`) mux la capture + TTS + overlays (`drawtext`/`ass`), ou réinjecte la capture dans Remotion via `<OffthreadVideo>` pour garder les captions animées.

### 8.5 Architecture SaaS concrète

**Blueprint A (défaut, Linux, sans GPU Windows) :**
```
Client → API (NestJS) → Queue (BullMQ/Redis) → Workers Remotion (Docker Linux)
                                                  │ TTS (Azure/ElevenLabs) → audio + timestamps mot
                                                  │ Remotion compose scène+overlays+captions+voix
                                                  └→ Rendu (Remotion Lambda) → S3/R2 → CDN
```
Rendu : **Remotion Lambda** (recommandé — chunks parallèles, navigateur inclus) ; alternatives **Cloud Run** (Alpha) ou **self-hosted Node/Bun** (compute le moins cher mais scaling/logs à gérer).

**Blueprint B (vraie appli Windows) :**
```
Client → API → Queue → [Worker Windows GPU: VM autologon]
                          │ Automatisation UI (Playwright / pyautogui)
                          │ OBS+obs-websocket OU ffmpeg ddagrab → capture.mp4 → S3
              → [Worker Linux post-prod (Docker)]
                          │ TTS + timestamps ; Overlays (Remotion OffthreadVideo OU ffmpeg) ; Mux final ffmpeg → S3/R2 → CDN
```
Séparer **capture (Windows, rare, coûteux)** et **post-production (Linux, parallélisable)**. Ne pas conteneuriser la capture bureau Windows.

**Couche commune :** orchestration **BullMQ + Redis** (stack Node/NestJS, avec *flows* pour découper capture→TTS→overlay→mux) ou **Celery + Redis/RabbitMQ** (Python) ; stockage objets **S3 / Cloudflare R2** ; métadonnées **Postgres/Mongo** ; **CDN** ; isolation : 1 worker lourd = 1 job (ffmpeg sature les cœurs), scaler horizontalement.

**Librairies précises :**
- **Node/TS** : `remotion`, `@remotion/lambda`, `@remotion/captions`, `@remotion/install-whisper-cpp`, `obs-websocket-js`, `playwright`/`@playwright/test`, `fluent-ffmpeg` (ou `execa`+ffmpeg), `bullmq`, `ioredis`, `@aws-sdk/client-s3`, `@elevenlabs/elevenlabs-js`, `microsoft-cognitiveservices-speech-sdk`, `openai`.
- **Python** : `obsws-python`, `ffmpeg-python`/`moviepy`, `aeneas`/`whisperx`, `elevenlabs`, `azure-cognitiveservices-speech`, `openai`, `piper-tts`, `kokoro`, `celery`, `redis`, `boto3`.

**À intégrer dans SallyCourse :** construire par défaut le **Blueprint A (Remotion-first)** — cohérent avec la stack NestJS des projets Sally : API NestJS → BullMQ/Redis → workers Remotion Docker Linux, TTS à timestamps natifs → `@remotion/captions` → Remotion Lambda → R2/S3+CDN. N'ajouter le Blueprint B (VM Windows GPU + OBS/ddagrab) que si un cours doit filmer une vraie appli native, en réintégrant la capture via `OffthreadVideo`.

Sources : [Remotion Lambda](https://www.remotion.dev/docs/lambda) · [Remotion vs SSR](https://www.remotion.dev/docs/compare-ssr) · [Chrome Headless Shell](https://www.remotion.dev/docs/miscellaneous/chrome-headless-shell) · [ddagrab](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Sources/Video/ddagrab.html) · [ffmpeg screen recording](https://ffmpeg-cookbook.com/en/articles/screen-recording/) · [obs-websocket](https://github.com/obsproject/obs-websocket) · [obs-websocket-py](https://github.com/Elektordi/obs-websocket-py) · [Playwright vs Puppeteer](https://www.browserstack.com/guide/playwright-vs-puppeteer) · [asciinema agg](https://docs.asciinema.org/manual/agg/) · [Remotion overlays](https://yuv.ai/blog/remotion) · [ffmpeg drawtext](https://www.ffmpeg-micro.com/blog/ffmpeg-add-text-to-video) · [ffmpeg subtitles/ass](https://github.com/endcycles/ffmpeg-engineering-handbook/blob/main/docs/advanced/subtitles.md) · [BullMQ flows](https://blog.taskforce.sh/splitting-heavy-jobs-using-bullmq-flows/) · [Celery+AWS Batch](https://aws.amazon.com/blogs/hpc/run-celery-workers-for-compute-intensive-tasks-with-aws-batch/) · [pipeline NestJS+BullMQ](https://medium.com/@mumerbilal142/building-a-scalable-video-scraper-pipeline-using-nestjs-bullmq-puppeteer-redis-mongodb-s3-4ab4bf9056a0)

---

## 9. Coûts — tarification et estimation par cours

### 9.1 Tarifs GPU Modal (base des calculs)

| GPU | $/seconde | ≈ $/heure | Usage typique |
|---|---|---|---|
| H100 | 0,001097 $ | ~3,95 $ | Vidéo (Mochi, Wan, Hunyuan), FLUX rapide |
| A100 80 Go | 0,000694 $ | ~2,50 $ | Vidéo, avatars diffusion (Hallo2) |
| A100 40 Go | 0,000583 $ | ~2,10 $ | LatentSync, SDXL |
| **L40S** | 0,000542 $ | ~1,95 $ | **Sweet spot** : TTS, MuseTalk, FLUX schnell, SDXL |
| A10G / T4 | (moins cher) | — | SadTalker, Kokoro, lip-sync léger |

Modal : **30 $/mois de compute gratuit**, facturation à la seconde, autoscale à zéro. Le **cold-start** (chargement des poids) est le vrai poste à optimiser (conteneurs "chauds", `torch.compile`, snapshots mémoire Modal).

### 9.2 Tarif Cloudflare Workers AI

- **Free tier : 10 000 Neurons/jour** (reset 00:00 UTC, pas de report), plans Free **et** Paid.
- **Au-delà : 0,011 $ / 1 000 Neurons** (0,000011 $/Neuron). Nécessite **Workers Paid (5 $/mois)**.
- **Neuron** = unité de compute GPU normalisée (token in/out, tuile image, min audio, 1 000 caractères).
- Équivalents gratuits/jour : ~287 k tokens sortie Llama 3.1 8B **OU** ~2 000 images FLUX Schnell 512² **OU** ~243 min transcription Whisper **OU** ~536 min TTS MeloTTS.

### 9.3 Estimation pipeline "1 minute de cours" (Modal, compute seul)

| Étape | Modèle | Temps ~ | Coût ~ |
|---|---|---|---|
| Narration audio (1 min) | Chatterbox (L40S) | ~15-30 s | ~0,01 $ |
| Narration (variante volume) | Kokoro (CPU/petit GPU) | quelques s | ~0,001 $ |
| Avatar lip-sync (1 min) | MuseTalk (L40S, temps réel) | ~60 s | **~0,03 $** |
| Avatar premium (1 min) | LatentSync (A100) | ~2-4 min | ~0,10-0,30 $ |
| 4 illustrations de slide | FLUX schnell (L40S/H100) | ~4-8 s | ~0,02-0,04 $ |
| 1 clip B-roll (10-20 s) | LTX-Video (H100 chaud) | ~2-5 s | ~0,005-0,01 $ |
| **Total ~1 min (config défaut)** | Chatterbox + MuseTalk + FLUX schnell + LTX | — | **≈ 0,05-0,10 $/min** |
| **Total premium** | LatentSync + Wan/Mochi | — | **≈ 0,40-0,80 $/min** |

Un cours de 30 min en config défaut ≈ **1,5-3 $ de GPU**. Les 30 $/mois gratuits de Modal couvrent le prototypage.

### 9.4 Création du token Cloudflare (étapes exactes)

1. Dashboard → page **Workers AI** → **Use REST API**. 2. **Create a Workers AI API Token** (template : permissions Workers AI Read + Edit). 3. **Create API Token**. 4. **Copy API Token** (affiché une seule fois). 5. Copier l'**Account ID** (requis dans l'URL). En-tête : `Authorization: Bearer {API_TOKEN}`.

**À intégrer dans SallyCourse :** budgéter en deux devises — Neurons Cloudflare (texte/TTS volume/images/STT, poste dominant = tokens de sortie LLM) et $-seconde Modal (avatar/clonage/vidéo). Optimiser le cold-start Modal (conteneurs chauds, torch.compile). Le free tier Cloudflare (10 k Neurons/j) + les 30 $/mois Modal couvrent tout le prototypage.

Sources : [Modal pricing](https://modal.com/pricing) · [coût L40S](https://modal.com/blog/nvidia-l40s-price-article) · [computeprices Modal](https://computeprices.com/providers/modal) · [pricing Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [token REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)

---

## 10. Pièges de licence — récapitulatif (à relire avant toute prod)

1. **XTTS-v2 (CPML) et F5-TTS (poids CC-BY-NC 4.0) = NON-COMMERCIAL.** Les plus recommandés en tuto clonage, interdits en SaaS payant. Coqui a fermé en 2024 (aucune licence achetable). Qualité AR de XTTS faible.
2. **FLUX.1 [dev] = NON-COMMERCIAL** (licence BFL séparée). Seul **[schnell]** est Apache 2.0.
3. **HunyuanVideo : interdit UE / UK / Corée du Sud** — rédhibitoire pour France/Maroc.
4. **LTX-Video** : gratuit commercial **seulement si < 10 M$ ARR** (sinon licence payante) ; aucune restriction géographique.
5. **LivePortrait (MIT)** : remplacer les modèles **InsightFace** (non-commerciaux) pour être conforme.
6. **Orpheus (Apache 2.0)** : respecter **en plus** la licence **Llama-3.2** des poids de base.
7. **Edge-TTS (`edge-tts`) = zone grise** (aucune autorisation Microsoft explicite pour usage commercial tiers) → basculer sur **Azure AI Speech** officiel en prod.
8. **SDXL (OpenRAIL++-M)** : commercial OK sans plafond, mais restrictions d'usage RAIL à respecter.
9. **SILMA TTS v1** : licence "highly permissive" annoncée → **à confirmer sur la fiche HF** avant mise en avant.
10. **Llama 3.x** (via Cloudflare) : commercial OK, AUP Llama à respecter (< 700 M MAU).

**Modèles pleinement "safe" et prioritaires :** MeloTTS, Kokoro, Chatterbox, Piper, MuseTalk, LatentSync, SadTalker, Hallo2, FLUX.1 [schnell], SDXL, Wan 2.2, Mochi, BGE-M3, Whisper — tous MIT / Apache 2.0 / OpenRAIL++-M.

---

## 11. Recommandation finale par palier

**Palier "Standard" (défaut, 100 % commercial, coût mini) :**
- Texte : Llama 3.3 70B fp8-fast + Llama 3.1 8B + Qwen 2.5 Coder 32B (Cloudflare).
- Voix : MeloTTS `lang='fr'` (Cloudflare) / Kokoro (FR-EN) + Chatterbox (voix signature/clonage AR/FR/EN, Modal) ; AR → SILMA/Piper.
- Avatar : MuseTalk (MIT, temps réel, Modal).
- Slides : FLUX-1 Schnell (Cloudflare / Modal) ou SDXL.
- B-roll : LTX-Video (Modal).
- Assemblage : Remotion (Blueprint A) + Remotion Lambda.
- RAG : BGE-M3 + Vectorize.

**Palier "Premium" (qualité max) :**
- Voix : Azure AI Speech (licence claire, WordBoundary) pour le rendu le plus naturel FR/EN/AR.
- Avatar : LatentSync 1.6 (Apache 2.0, diffusion HD, Modal).
- Vidéo : Wan 2.2 (Apache 2.0, 100 % sans plafond) — éviter HunyuanVideo.
- Slides : licence commerciale FLUX.1 [dev] via BFL si la qualité [dev] est indispensable.

**Effort d'ingénierie principal :** écrire les images Modal pour **MuseTalk** et **LatentSync** (aucun template officiel talking-head/lip-sync sur Modal). Tout le reste (LLM, TTS, images, vidéo, STT, embeddings) a des exemples/endpoints réutilisables.

**Templates Modal officiels réutilisables tels quels :** Images — `flux`, `text_to_image`, `diffusers_lora_finetune`, `image_to_image`. Vidéo — `ltx`, `image_to_video`, `music-video-gen` (Wan 2.1), `mochi`. Audio/voix — `chatterbox_tts`, exemple `Dia`, `batched_whisper`, `streaming_kyutai_stt`, `llm-voice-chat` (Moshi), `generate_music` (ACE-Step). Source : [Modal Featured examples](https://modal.com/docs/examples).

---

## 12. Fiabilité et notes

- Licences vérifiées à la source (dépôts GitHub / HF / pages légales) — **haute confiance**.
- Tarifs Modal et Neurons Cloudflare issus des pages pricing officielles ; prix/seconde GPU recoupés (confiance moyenne-haute, à revalider sur facture réelle). Temps d'exécution par modèle = **estimations d'ingénierie**, à benchmarker sur Modal avant chiffrage client.
- Les **IDs de modèles Cloudflare évoluent chaque mois** — vérifier live sur `developers.cloudflare.com/workers-ai/models/` avant de coder en dur.
- L'API OpenAI-compatible Cloudflare ne couvre **que chat + embeddings** ; TTS/images/Whisper passent par l'endpoint natif `/ai/run/@cf/{model}` (ou `env.AI.run()` dans un Worker).