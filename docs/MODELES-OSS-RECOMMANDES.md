# Modèles ML gratuits recommandés (texte, voix, captures TP, synchro A/V)

> Recherche du 2026-07-13 — état de l'art des modèles **gratuits** utilisables
> par SallyCourse pour les 3 langues du produit (FR / EN / AR), l'enregistrement
> des TP sur la machine du formateur et la synchronisation voix/vidéo.
> Licences vérifiées sous l'angle SaaS commercial (règle P160 : jamais de
> non-commercial dans le pipeline par défaut).

## 1. LLM texte (plan, scripts, articles, quiz) — via Ollama

| Modèle | Taille | Licence | FR | EN | AR | Verdict |
|---|---|---|---|---|---|---|
| **Qwen3** 4b/8b/14b | 2,6–9 Go | Apache 2.0 | ✅✅ | ✅✅ | ✅✅ | **Choix n°1** (100+ langues, aucun blocage commercial) |
| **Qwen2.5** 3b/7b/14b | 1,9–9 Go | Apache 2.0 | ✅✅ | ✅✅ | ✅ | Meilleur multilingue de sa génération — le 3b est notre minimum CPU actuel |
| **Gemma 3** 4b/12b | 3,3–8 Go | Gemma (commercial OK) | ✅✅ | ✅✅ | ✅ | Excellent petit modèle (140 langues) |
| **Llama 3.1/3.3** 8b | 4,9 Go | Llama (OK < 700 M MAU) | ✅ | ✅✅ | ➖ | Bon FR/EN, arabe moyen |
| Spécial arabe : **Jais** (Core42), **SILMA**, **AceGPT** | 7-13b | permissives | ➖ | ✅ | ✅✅ | À tirer uniquement pour les cours AR exigeants |

Commandes : `ollama pull qwen3:8b` · `ollama pull qwen2.5:7b` · `ollama pull gemma3:4b`.
Sur la machine actuelle (CPU, ~8 Go de disque libre) : `qwen2.5:3b` installé ;
**recommandé dès ~6 Go libérés : `qwen3:4b` ou `qwen2.5:7b`** (qualité nettement
supérieure pour les scripts). Avec GPU : `qwen3:14b`+.

## 2. Voix TTS gratuites pour les 3 langues

| Moteur | Licence | FR | EN | AR | Notes |
|---|---|---|---|---|---|
| **Piper** | MIT | `fr_FR-siwis`, `fr_FR-upmc` | `en_US-lessac`, `en_US-amy`, `en_GB-alan`… | **`ar_JO-kareem`** | CPU temps réel, ~60 Mo/voix — **seul moteur MIT couvrant les 3 langues** |
| **Kokoro-82M** | Apache 2.0 | `ff_siwis` | `af_heart`, `am_michael`… | ❌ (v1.0) | Déjà intégré et FONCTIONNEL dans le pipeline (service docker `kokoro`) |
| **MeloTTS** | MIT | ✅ | ✅ (4 accents) | ❌ | Alternative légère FR/EN |
| MMS-TTS (Meta) | CC-BY-NC ⚠ | ✅ | ✅ | ✅ (1100+ langues) | NON-commercial — interdit dans le SaaS |
| XTTS-v2 / F5-TTS | CPML / CC-BY-NC ⚠ | — | — | — | NON-commercial — exclus (décision P153 confirmée) |

**Stratégie retenue** : Kokoro (déjà branché, FR/EN) + **Piper binaire pour l'arabe**
(`ar_JO-kareem`). ⚠ Constat terrain : l'image `lscr.io/linuxserver/piper` du
compose parle le protocole Wyoming, PAS l'API REST attendue par
`piper-provider.ts` — remplacer par un wrapper HTTP maison autour du binaire
`piper` (contrat `POST /api/text-to-speech {text, voice, length_scale}` → WAV).

## 3. Enregistrer les TP sur l'ordinateur du formateur (prise de commandes + capture)

Outils nécessaires, du plus intégré au plus manuel :

1. **Playwright video** (déjà dans le worker) — enregistre les TP **navigateur**
   en WebM sans rien installer : `browser.newContext({ recordVideo: {...} })`.
   C'est le moteur des screencasts P85 existants.
2. **ttyd + docker** (déjà intégré, P22 `tp-environments.ts`) — TP **terminal** :
   exécution des commandes dans un conteneur, capture du terminal web.
   Alternative élégante : **asciinema** (+ `agg` pour convertir en MP4/GIF).
3. **OBS Studio + obs-websocket** (GPL, plugin inclus depuis OBS 28) — capture
   **de tout l'écran ou d'une fenêtre précise**, pilotable par script
   (`obs-websocket-js` sur npm : start/stop/scènes). La voie pro pour des TP
   sur applications natives (IDE, etc.).
4. **FFmpeg `ddagrab`/`gdigrab`** (Windows) — capture de fenêtre en pure ligne
   de commande, zéro UI : `ffmpeg -f gdigrab -i title="Fenêtre" out.mp4`.
5. **Rejouer les actions automatiquement** : `nut.js` (npm, souris/clavier
   multiplateforme) ou AutoHotkey (Windows) pour scénariser un TP répétable.

⚠ Règle de sécurité (voir mémoire projet) : ne JAMAIS capturer le bureau
entier — toujours une fenêtre/source isolée (fuite d'informations sinon).

## 4. Synchroniser la voix générée avec la vidéo enregistrée

Deux besoins distincts :

### a) Caler une voix off sur un screencast (cas TP)
1. Découper la narration par étape du TP (le script du TP fournit déjà le texte).
2. Synthétiser chaque segment (Kokoro/Piper).
3. Aligner : **WhisperX** (timestamps mot-à-mot via wav2vec2 — le projet embarque
   déjà faster-whisper) ou **aeneas** (forced alignment texte↔audio, léger).
4. Assembler avec **FFmpeg** (`adelay`/`atrim`/`concat`) — déjà dans le pipeline.
   → Aucune brique nouvelle à installer : whisper + ffmpeg sont déjà là.

### b) Lip-sync d'un avatar qui « parle » (cas présentateur)
| Outil | Licence | GPU | Verdict |
|---|---|---|---|
| **SadTalker** | Apache 2.0 | requis | Déjà intégré (P155) — photo → talking head |
| **Wav2Lip** | non-commercial (recherche) ⚠ | léger | Précis mais licence à vérifier au cas par cas |
| **MuseTalk** (Tencent) | MIT | requis | Meilleure qualité temps réel 2026 |
| **LatentSync** (ByteDance) | Apache 2.0 | requis | Rapide, bonne préservation d'identité |

Sans GPU sur la machine : rester sur slides + voix (format déjà accepté par
Udemy) ; activer SadTalker/MuseTalk le jour où un GPU est disponible.

## 5. Sources

- [Best Open-Source LLMs to run locally 2026 (Hugging Face)](https://huggingface.co/blog/daya-shankar/open-source-llm-models-to-run-locally)
- [Best Ollama Models 2026 (Morph)](https://www.morphllm.com/best-ollama-models)
- [Best Open-Source TTS 2026 (BentoML)](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [Licences TTS locales : Piper, XTTS, F5 (PromptQuorum)](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)
- [Open-source lip sync 2026 : Wav2Lip, MuseTalk… (lipsync.com)](https://lipsync.com/blog/open-source-lip-sync)
- [MuseTalk (GitHub)](https://github.com/TMElyralab/MuseTalk)
- [aeneas — forced alignment](https://www.readbeyond.it/aeneas/)
- [WhisperX 2026 — word timestamps](https://localaimaster.com/blog/whisperx-guide)
- [OBS start/stop par CLI/websocket](https://obsproject.com/forum/threads/cli-stop-and-start-for-timed-recording.152689/)
- [Screen recording avec Playwright](https://dev.to/headlesstesting/screen-recording-with-playwright-5dm0)
