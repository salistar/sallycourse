# Déploiement Modal — voix premium multilingue Chatterbox (MIT, commercial OK).
# Fournit à SallyCourse une narration très naturelle FR/EN/AR + le CLONAGE de
# voix personnalisée (audio_prompt) — au-delà des voix Edge/Piper/Kokoro.
#
# Déploiement :   modal deploy modal/chatterbox_tts.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) attendu par le worker :
#   POST {url}  JSON { text, language, audio_prompt_b64?, context? }  ->  audio/wav
#
# GPU L4, scale-à-zéro après 5 min d'inactivité (coût uniquement à l'usage).
#
# ── Audit ESG 2026-07-19 (E12/E13) — cohérence de la voix entre chunks ────────
# Chatterbox tronque au-delà de ~300 caractères par appel de `generate()` : la
# narration est donc OBLIGATOIREMENT découpée en morceaux, chacun un appel de
# modèle séparé. Mesuré sur un cours réel : 189 sauts de registre (F0) >18 %
# entre phrases adjacentes (jusqu'à 64 %, un chunk entier dégénéré à ~70 Hz
# pendant 8 s) + 96 bursts non-voisés parasites. Quatre correctifs ci-dessous :
#   1. `_split_text` groupe les phrases jusqu'à la limite RÉELLE du modèle
#      (pas de gain à découper plus fin que nécessaire — moins d'appels =
#      moins de points de rupture).
#   2. Conditionnement FIGÉ par requête : `prepare_conditionals` appelé UNE
#      fois (le clonage de voix n'est ré-embedé qu'une fois, pas par chunk) +
#      seed PyTorch fixe re-posée avant CHAQUE `generate()` (même point de
#      départ RNG → échantillonnage stochastique beaucoup plus stable d'un
#      chunk à l'autre) + température/exagération abaissées (moins de dérive).
#   3. QA par chunk avec retry : après génération, un chunk dont l'énergie ou
#      le F0 médian s'écarte trop de la médiane de la leçon (jusqu'ici acquise)
#      est régénéré (jusqu'à 2 tentatives) — attrape le cas du chunk dégénéré.
#   4. Assemblage : trim des bords quasi-silencieux de chaque chunk, ré-
#      normalisation RMS par chunk (évite les sauts de niveau au raccord), et
#      crossfade court (~15 ms) au lieu d'une coupe franche + silence pur.
#
# ── Audit ESG 2026-07-20 (E14) — récidive après le correctif 3/`_has_dead_air` ─
# Un cours généré APRÈS le déploiement des correctifs ci-dessus présentait
# encore des trous audio de 1-7,5 s EN PLEIN MILIEU d'une diapositive (vérifié
# rigoureusement : cross-référencé aux frontières réelles de slides, pas une
# transition normale). Root cause probable : les heuristiques RMS/F0/plage-morte
# sont des proxies ACOUSTIQUES — elles ne vérifient jamais que l'audio produit
# correspond RÉELLEMENT au texte demandé. Deux correctifs supplémentaires :
#   5. Vérification de CONTENU par Whisper (petit modèle multilingue, chargé
#      dans CE MÊME conteneur GPU — pas d'aller-retour vers l'app whisper
#      dédiée, coût/latence par chunk trop élevés pour large-v3) : chaque chunk
#      accepté par les heuristiques acoustiques est transcrit et comparé au
#      texte source demandé (similarité de séquence). Un décalage important
#      (transcription vide, tronquée ou sans rapport) est un signal FIABLE de
#      dégénérescence que RMS/F0 peuvent manquer — c'est exactement le trou
#      mesuré : audio non-silencieux mais NE DISANT PAS ce qui était demandé.
#   6. Journalisation complète (print, capturés par `modal app logs`) : chaque
#      décision de retry est désormais tracée (texte, rms, f0, dead_air,
#      similarité Whisper, tentative). Avant ce correctif, AUCUN log n'existait
#      dans la boucle — impossible de diagnostiquer une récidive après coup.
#      `context` (optionnel, ex. `courseId:lessonId:slideN`) préfixe chaque
#      ligne pour corréler un défaut observé sur un cours à son run exact.
#
# ── Root cause RÉELLE d'E14, trouvée grâce aux logs du correctif 6 ────────────
# Premier test après déploiement des correctifs 5/6 : un chunk dégénéré
# (dead_air=True) a produit un rms/f0 IDENTIQUES À LA DÉCIMALE PRÈS sur ses 3
# tentatives (0,1113/137,1 Hz les trois fois). Cause : `generate_chunk` re-
# posait le MÊME `FIXED_SEED` avant CHAQUE tentative (correctif 2) — donc même
# texte + même seed + même modèle = sortie byte-identique. La boucle de retry
# du correctif 3 n'a donc JAMAIS eu d'effet sur un chunk réellement dégénéré
# depuis son introduction : elle consommait 2 générations GPU gratuites par
# chunk suspect sans jamais changer le résultat. C'est la cause probable (a)
# évoquée dans l'audit du 2026-07-20 ("le fix ne généralise pas") — en réalité
# le fix ne s'exécutait simplement jamais.
#   7. `generate_chunk` varie désormais le seed par tentative (FIXED_SEED +
#      attempt) : la tentative 0 reste inchangée (préserve le bénéfice du
#      correctif 2 dans le cas nominal, sans retry) ; un retry utilise un seed
#      différent, donnant enfin une chance réelle d'obtenir un échantillonnage
#      différent (et donc potentiellement sain) du même texte.
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-tts")


class TTSRequest(BaseModel):
    text: str
    language: str = "fr"
    audio_prompt_b64: Optional[str] = None
    # Traçabilité uniquement (journalisation) — voir correctif 6 ci-dessus.
    context: Optional[str] = None


# Chatterbox rend au mieux ~1 phrase / ~300 caractères à la fois ; au-delà il
# TRONQUE (contrainte réelle du modèle, pas un choix arbitraire — inutile de
# viser plus bas : moins d'appels de `generate()` = moins de points de rupture
# de registre, cf. correctif 1 de l'audit ESG). On découpe donc la narration
# en morceaux (frontières de phrase) au plus près de cette limite, et on
# concatène l'audio côté GPU pour éviter toute coupure dans les longues
# narrations.
CHATTERBOX_MAX_CHARS = 295


def _split_text(text: str, max_chars: int = CHATTERBOX_MAX_CHARS):
    import re

    # Segmente sur . ! ? … ؟ (arabe) et sauts de ligne, en gardant le séparateur.
    parts = re.split(r"(?<=[.!?…؟\n])\s+", text.strip())
    chunks, cur = [], ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Phrase déjà trop longue : on coupe sur la virgule, sinon sur la longueur.
        if len(part) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            sub, buf = re.split(r"(?<=[,;:])\s+", part), ""
            for s in sub:
                if len(buf) + len(s) + 1 <= max_chars:
                    buf = (buf + " " + s).strip()
                else:
                    if buf:
                        chunks.append(buf)
                    buf = s if len(s) <= max_chars else s[:max_chars]
            if buf:
                cur = buf
            continue
        if len(cur) + len(part) + 1 <= max_chars:
            cur = (cur + " " + part).strip()
        else:
            if cur:
                chunks.append(cur)
            cur = part
    if cur:
        chunks.append(cur)
    return chunks or [text.strip()]


# Image : base CUDA+cuDNN (PAS debian_slim) — requise par faster-whisper/
# CTranslate2 pour l'inférence GPU (correctif 5, cf. audit ci-dessus) ; même
# base que modal/whisper_transcribe.py, qui documente explicitement ce piège :
# sans cuDNN, le chargement du modèle Whisper crash-loop au démarrage du
# conteneur. torch CUDA (wheels PyPI 2.x) reste compatible avec cette base.
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "libsndfile1", "git")
    .pip_install("chatterbox-tts", "soundfile", "fastapi[standard]", "numpy", "faster-whisper==1.1.0")
)

# Cache des poids HuggingFace entre cold-starts (téléchargés une seule fois).
hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

# Seed PyTorch fixe (déterminisme du RNG global entre chunks, correctif 2) —
# arbitraire mais stable : la valeur exacte importe peu, seule la RÉPÉTITION
# de la même graine avant chaque appel compte.
FIXED_SEED = 424242
# Génération plus posée/consistante qu'un réglage par défaut plus expressif —
# moins de variance stochastique d'un chunk à l'autre (correctif 2).
GENERATION_TEMPERATURE = 0.6
GENERATION_EXAGGERATION = 0.4
GENERATION_CFG_WEIGHT = 0.5

# Correctif 7 (audit ESG 2026-07-20) : à GENERATION_TEMPERATURE=0.6, la
# distribution de sampling est si peaked qu'un simple changement de seed ne
# suffit PAS à échapper un piège de répétition détecté par le modèle lui-même
# (`alignment_stream_analyzer` force un EOS anticipé) — mesuré : rms/f0
# identiques à la décimale près sur un chunk dégénéré, seed différent inclus.
# Sur un RETRY (donc uniquement après un premier échec constaté), on relâche
# temporairement la température/exagération pour donner au sampler une vraie
# chance de sortir de cette trajectoire — le prix (un peu plus de variance
# de registre) n'est payé QUE sur les chunks déjà repérés comme suspects,
# jamais sur le chemin nominal.
RETRY_TEMPERATURE_STEP = 0.15
RETRY_EXAGGERATION_STEP = 0.1
RETRY_MAX_TEMPERATURE = 1.0
RETRY_MAX_EXAGGERATION = 0.7

# QA par chunk (correctif 3) : bornes de plausibilité vs la médiane courante
# de la leçon. RMS_MIN_RATIO trop bas = quasi-silence/dégénéré. F0 en dehors
# de la plage vocale humaine (env. 60-400 Hz pour une narration mixte) = chunk
# probablement corrompu (cf. le chunk mesuré à ~70 Hz sur ce cours ESG).
CHUNK_RETRY_MAX_ATTEMPTS = 2
CHUNK_MIN_RMS = 1e-3
CHUNK_F0_MIN_HZ = 60.0
CHUNK_F0_MAX_HZ = 400.0
CHUNK_F0_DEVIATION_RATIO = 0.35  # écart max toléré vs la médiane leçon avant retry.

# Détection de « plage morte » interne (audit ESG 2026-07-20, cours généré
# APRÈS le correctif 3 ci-dessus — donc un vrai trou dans la couverture, pas
# une régression). Mesuré sur un chunk réel : narration saine RMS ~0,07-0,15,
# puis un trou de ~3 s à RMS ~0,001-0,01 (silence/murmure perceptible à
# l'oreille) — AU-DESSUS du seuil absolu CHUNK_MIN_RMS=1e-3, donc invisible.
# Root cause : `rms`/`f0` ci-dessus sont des stats AGRÉGÉES sur tout le chunk —
# un trou localisé au milieu d'un chunk par ailleurs sain ne fait pas assez
# bouger la médiane globale pour franchir le seuil. Fenêtre glissante à seuil
# RELATIF (percentile du chunk lui-même, pas une valeur absolue) : détecte le
# trou quel que soit le niveau de sortie global de ce chunk/cette voix.
DEAD_AIR_WINDOW_SEC = 0.5
DEAD_AIR_MIN_RUN_SEC = 0.8  # durée consécutive sous le seuil avant de déclencher.
DEAD_AIR_RELATIVE_RATIO = 0.12  # fraction du niveau typique (p75 des fenêtres) du chunk.

# Assemblage (correctif 4).
CROSSFADE_SECONDS = 0.015
TRIM_THRESHOLD_RATIO = 0.02  # fraction du pic absolu du chunk, sous laquelle on trime.
GAP_SECONDS = 0.18  # respiration entre phrases (bords déjà trimés avant ce gap).

# Vérification de contenu par Whisper (correctif 5). Modèle "small" (pas
# large-v3 comme whisper_transcribe.py) : chargé dans CE conteneur, appelé une
# fois PAR CHUNK (donc potentiellement des dizaines de fois par leçon) — la
# latence/précision de large-v3 n'est pas nécessaire ici, on cherche juste un
# décalage GROSSIER texte-attendu vs texte-transcrit, pas une transcription de
# référence. CHUNK_MIN_SIMILARITY_RATIO : sous ce seuil de SequenceMatcher
# (0-1), la transcription ne correspond pas assez au texte demandé pour faire
# confiance à l'audio, MÊME si les heuristiques acoustiques rms/f0/dead_air
# n'ont rien détecté (c'est précisément le trou de couverture de l'audit
# 2026-07-20 : audio non-silencieux mais ne disant pas ce qui était demandé).
# Chunks très courts (peu de mots) : la similarité de séquence est bruitée sur
# de très petites chaînes -> on ne l'applique qu'au-delà d'une longueur mini.
WHISPER_MODEL_NAME = "small"
WHISPER_MIN_CHARS_TO_CHECK = 12
CHUNK_MIN_SIMILARITY_RATIO = 0.45


def _rms(seg) -> float:
    import numpy as np

    if seg.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(seg, dtype=np.float64))))


def _median_f0_hz(seg, sr: int) -> float:
    """F0 médian par autocorrélation sur fenêtres de 40 ms (numpy seul, pas de
    dépendance DSP lourde — suffisant pour une QA de plausibilité, pas pour une
    mesure de précision musicale)."""
    import numpy as np

    frame = max(1, int(sr * 0.04))
    hop = max(1, frame // 2)
    lo = max(1, sr // int(CHUNK_F0_MAX_HZ))
    hi = max(lo + 1, sr // int(CHUNK_F0_MIN_HZ))
    f0s = []
    for start in range(0, max(0, seg.size - frame), hop):
        fr = seg[start : start + frame].astype(np.float64)
        fr = fr - fr.mean()
        if np.abs(fr).max() < 1e-4:
            continue
        corr = np.correlate(fr, fr, mode="full")[frame - 1 :]
        denom = corr[0] if corr[0] != 0 else 1e-12
        corr = corr / denom
        if hi >= len(corr):
            continue
        seg_corr = corr[lo:hi]
        if seg_corr.size == 0:
            continue
        i = int(np.argmax(seg_corr))
        if seg_corr[i] < 0.35:
            continue
        f0s.append(sr / (lo + i))
    if not f0s:
        return 0.0
    return float(np.median(f0s))


def _has_dead_air(seg, sr: int) -> bool:
    """Détecte une plage de quasi-silence SOUTENUE au sein d'un chunk par
    ailleurs vocalement actif — complète le contrôle `rms`/`f0` agrégé sur tout
    le chunk (voir DEAD_AIR_* ci-dessus). Fenêtre glissante 0,5 s, seuil relatif
    au niveau typique (percentile 75) de CE chunk : robuste quel que soit le
    volume de sortie global (voix clonée plus douce, etc.)."""
    import numpy as np

    win = max(1, int(sr * DEAD_AIR_WINDOW_SEC))
    if seg.size < win * 2:
        return False
    n_windows = seg.size // win
    win_rms = np.array([_rms(seg[i * win : (i + 1) * win]) for i in range(n_windows)])
    reference = float(np.percentile(win_rms, 75))
    if reference <= 1e-6:
        return False  # chunk globalement quasi silencieux : déjà couvert par rms < CHUNK_MIN_RMS.
    threshold = reference * DEAD_AIR_RELATIVE_RATIO
    max_run = 0
    cur = 0
    for w in win_rms:
        cur = cur + 1 if w < threshold else 0
        max_run = max(max_run, cur)
    return (max_run * DEAD_AIR_WINDOW_SEC) >= DEAD_AIR_MIN_RUN_SEC


def _trim_silence(seg, threshold_ratio: float = TRIM_THRESHOLD_RATIO):
    """Retire le silence quasi-numérique en tête/queue d'un chunk (correctif 4)
    — évite d'accumuler des bords morts qui accentuent les à-coups au raccord."""
    import numpy as np

    if seg.size == 0:
        return seg
    peak = float(np.abs(seg).max())
    if peak <= 1e-6:
        return seg
    threshold = peak * threshold_ratio
    above = np.where(np.abs(seg) > threshold)[0]
    if above.size == 0:
        return seg
    return seg[above[0] : above[-1] + 1]


def _crossfade_concat(pieces, sr: int):
    """Concatène une liste de segments avec un court fondu enchaîné (correctif
    4) au lieu d'une coupe franche — atténue la perception d'un raccord brut
    entre deux chunks au registre légèrement différent."""
    import numpy as np

    if not pieces:
        return np.zeros(1, dtype=np.float32)
    fade_n = max(1, int(sr * CROSSFADE_SECONDS))
    out = pieces[0].astype(np.float32)
    for seg in pieces[1:]:
        seg = seg.astype(np.float32)
        n = min(fade_n, out.size, seg.size)
        if n <= 1:
            out = np.concatenate([out, seg])
            continue
        fade_out = np.linspace(1.0, 0.0, n, dtype=np.float32)
        fade_in = np.linspace(0.0, 1.0, n, dtype=np.float32)
        head = out[:-n]
        tail = out[-n:] * fade_out + seg[:n] * fade_in
        rest = seg[n:]
        out = np.concatenate([head, tail, rest])
    return out


def _normalize_for_compare(text: str) -> str:
    """Normalisation légère avant comparaison de similarité (correctif 5) :
    minuscules, ponctuation retirée, espaces compactés. But = comparer le
    CONTENU parlé, pas la mise en forme (Whisper ne restitue pas la ponctuation
    ni la casse de façon fiable)."""
    import re

    t = text.lower()
    t = re.sub(r"[.,;:!?…«»\"'()\-–—]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _transcript_similarity(expected_text: str, transcribed_text: str) -> float:
    """Similarité de séquence (0-1) entre le texte demandé et la transcription
    Whisper du chunk généré (correctif 5). `difflib` seul (stdlib) suffit ici :
    on cherche un décalage GROSSIER (transcription vide/tronquée/hors-sujet),
    pas une mesure fine de qualité de synthèse."""
    import difflib

    a = _normalize_for_compare(expected_text)
    b = _normalize_for_compare(transcribed_text)
    if not a:
        return 1.0
    if not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _transcribe_chunk(whisper_model, seg, sr: int, language: str) -> str:
    """Transcrit un chunk audio déjà généré via le petit modèle Whisper chargé
    dans ce conteneur (correctif 5). Écrit un WAV temporaire (interface fichier
    de faster-whisper) plutôt que de streamer les échantillons — coût
    négligeable vs la génération TTS elle-même."""
    import os
    import tempfile

    import soundfile as sf

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        sf.write(tmp.name, seg, sr, format="WAV")
        segments, _info = whisper_model.transcribe(
            tmp.name, language=language, vad_filter=True, beam_size=1
        )
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=600,
)
class Chatterbox:
    @modal.enter()
    def load(self):
        import time

        import torch  # noqa: F401

        # Modèle multilingue (23 langues) si dispo, sinon anglais seul.
        self.multilingual = True
        t0 = time.time()
        try:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            self.model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
        except Exception:
            from chatterbox.tts import ChatterboxTTS

            self.multilingual = False
            self.model = ChatterboxTTS.from_pretrained(device="cuda")
        print(f"[chatterbox] modèle chargé (multilingual={self.multilingual}) en {time.time() - t0:.1f}s")

        # Correctif 5 : petit modèle Whisper chargé UNE FOIS dans ce même
        # conteneur GPU, réutilisé pour vérifier chaque chunk généré.
        t1 = time.time()
        from faster_whisper import WhisperModel

        self.whisper = WhisperModel(WHISPER_MODEL_NAME, device="cuda", compute_type="float16")
        print(f"[chatterbox] whisper '{WHISPER_MODEL_NAME}' chargé en {time.time() - t1:.1f}s")

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def tts(self, req: TTSRequest):
        import base64
        import io
        import os
        import tempfile
        import time

        import numpy as np
        import soundfile as sf
        import torch
        from fastapi import Response

        # Préfixe de traçabilité (correctif 6) — vide si non fourni par
        # l'appelant (ex. anciens workers pas encore mis à jour).
        ctx = req.context or "?"
        log_prefix = f"[chatterbox:{ctx}]"

        t_start = time.time()
        text = (req.text or "").strip()
        if not text:
            print(f"{log_prefix} requête rejetée : texte vide")
            return Response(content=b'{"error":"text vide"}', media_type="application/json", status_code=400)
        language = (req.language or "fr").lower()
        chunks_preview = _split_text(text)
        print(
            f"{log_prefix} requête reçue : {len(text)} caractères, langue={language}, "
            f"clone_voix={bool(req.audio_prompt_b64)}, {len(chunks_preview)} chunk(s)"
        )

        gen_kwargs = {}
        if self.multilingual:
            gen_kwargs["language_id"] = language
        # Réglages de génération plus stables (correctif 2) — appliqués
        # uniquement si le modèle les accepte (défensif : versions de la lib).
        for key, value in (
            ("temperature", GENERATION_TEMPERATURE),
            ("exaggeration", GENERATION_EXAGGERATION),
            ("cfg_weight", GENERATION_CFG_WEIGHT),
        ):
            gen_kwargs[key] = value

        # Clonage de voix optionnel : échantillon WAV base64 -> audio_prompt_path.
        tmp_path = None
        prompt_b64 = req.audio_prompt_b64
        conditioned = False
        try:
            if prompt_b64:
                tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp.write(base64.b64decode(prompt_b64))
                tmp.flush()
                tmp.close()
                tmp_path = tmp.name

                # Conditionnement FIGÉ (correctif 2) : préparer les latents de
                # référence UNE SEULE fois pour toute la leçon, plutôt que de
                # repasser audio_prompt_path à chaque appel de generate() (qui
                # ré-embarque potentiellement l'échantillon à chaque chunk —
                # source de variance de registre entre chunks). Défensif :
                # certaines versions de la lib n'exposent pas cette méthode.
                prepare = getattr(self.model, "prepare_conditionals", None)
                if callable(prepare):
                    try:
                        prepare(tmp_path, exaggeration=GENERATION_EXAGGERATION)
                        conditioned = True
                    except Exception:
                        conditioned = False
                if not conditioned:
                    gen_kwargs["audio_prompt_path"] = tmp_path

            sr = int(self.model.sr)

            def generate_chunk(chunk_text: str, attempt: int = 0):
                # Seed fixe re-posée avant CHAQUE appel (correctif 2) : force le
                # RNG global au même état de départ, ce qui rapproche fortement
                # le registre/la prosodie échantillonnés d'un chunk à l'autre.
                #
                # Correctif 7 (audit ESG 2026-07-20, trouvé via les logs du
                # correctif 6) : la tentative 0 garde EXACTEMENT FIXED_SEED
                # (préserve le bénéfice du correctif 2 dans le cas nominal sans
                # retry). Mais un RETRY (attempt>0) doit utiliser un seed
                # DIFFÉRENT — sinon même texte + même seed + même modèle = sortie
                # BYTE-IDENTIQUE, donc les tentatives de retry ne changent
                # jamais rien. C'est très exactement ce que les logs ont capturé
                # sur la récidive E14 : un chunk dégénéré (dead_air=True) avec
                # rms/f0 identiques à la décimale près sur ses 3 tentatives — la
                # boucle de retry ne faisait donc RIEN depuis son introduction,
                # elle épuisait juste 2 générations GPU gratuites pour rien.
                seed = FIXED_SEED + attempt
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(seed)

                call_kwargs = dict(gen_kwargs)
                if attempt > 0:
                    # Un seed différent seul ne suffit pas à sortir d'un piège
                    # de répétition à basse température (constaté sur les logs,
                    # cf. commentaire ci-dessus) : on relâche temporairement
                    # temperature/exaggeration, seulement pour ce retry.
                    if "temperature" in call_kwargs:
                        call_kwargs["temperature"] = min(
                            RETRY_MAX_TEMPERATURE,
                            GENERATION_TEMPERATURE + RETRY_TEMPERATURE_STEP * attempt,
                        )
                    if "exaggeration" in call_kwargs:
                        call_kwargs["exaggeration"] = min(
                            RETRY_MAX_EXAGGERATION,
                            GENERATION_EXAGGERATION + RETRY_EXAGGERATION_STEP * attempt,
                        )

                wav = self.model.generate(chunk_text, **call_kwargs)
                return wav.squeeze(0).detach().cpu().numpy().astype(np.float32)

            # QA par chunk avec retry (correctif 3) : la médiane F0 de la leçon
            # s'affine au fil des chunks déjà validés ; un chunk hors plage
            # vocale plausible OU trop loin de cette médiane est régénéré.
            lesson_f0_history = []
            trimmed_pieces = []
            total_retries = 0
            for chunk_idx, chunk_text in enumerate(chunks_preview):
                best_seg = None
                for attempt in range(CHUNK_RETRY_MAX_ATTEMPTS + 1):
                    seg = generate_chunk(chunk_text, attempt)
                    trimmed = _trim_silence(seg)
                    rms = _rms(trimmed)
                    f0 = _median_f0_hz(trimmed, sr)
                    dead_air = _has_dead_air(trimmed, sr)
                    # Quasi-silence : dégénéré sans ambiguïté. Pitch détecté
                    # mais hors plage vocale plausible (le cas mesuré : chunk
                    # entier effondré à ~70 Hz) : dégénéré aussi. En revanche
                    # f0==0 SEUL (pitch non détecté) n'est PAS dégénéré — un
                    # chunk court/consonantique légitime peut très bien ne
                    # jamais franchir le seuil de voisement de l'heuristique
                    # d'autocorrélation ; le flaguer déclencherait des retries
                    # inutiles (coût GPU) sur de l'audio parfaitement valide.
                    # `_has_dead_air` complète les deux stats agrégées ci-dessus :
                    # une plage morte SOUTENUE au milieu d'un chunk par ailleurs
                    # sain ne fait pas assez bouger rms/f0 GLOBAUX pour franchir
                    # leurs seuils (cas réel mesuré, audit 2026-07-20).
                    acoustically_degenerate = (
                        rms < CHUNK_MIN_RMS
                        or (f0 > 0 and not (CHUNK_F0_MIN_HZ <= f0 <= CHUNK_F0_MAX_HZ))
                        or dead_air
                    )

                    # Correctif 5 : vérification de CONTENU, indépendante des
                    # heuristiques acoustiques ci-dessus. On ne transcrit que si
                    # l'acoustique semble déjà correcte (évite de payer le coût
                    # Whisper sur un chunk déjà rejeté sur des critères moins
                    # chers) — mais AVANT off_register, car un chunk peut être
                    # acoustiquement "normal" (pas de silence, pitch plausible)
                    # tout en ne prononçant PAS le bon texte (Chatterbox répète,
                    # tronque, ou dérive sur un autre passage du prompt).
                    similarity = None
                    transcript = ""
                    if not acoustically_degenerate and len(chunk_text) >= WHISPER_MIN_CHARS_TO_CHECK:
                        try:
                            transcript = _transcribe_chunk(self.whisper, trimmed, sr, language)
                            similarity = _transcript_similarity(chunk_text, transcript)
                        except Exception as exc:  # défensif : Whisper ne doit jamais faire échouer la requête TTS.
                            print(f"{log_prefix} chunk {chunk_idx} tentative {attempt} : échec transcription Whisper ({exc}) — ignoré")
                    content_degenerate = similarity is not None and similarity < CHUNK_MIN_SIMILARITY_RATIO
                    degenerate = acoustically_degenerate or content_degenerate

                    off_register = False
                    if lesson_f0_history and f0 > 0:
                        baseline = float(np.median(lesson_f0_history))
                        off_register = baseline > 0 and abs(f0 - baseline) / baseline > CHUNK_F0_DEVIATION_RATIO

                    temp_used = (
                        GENERATION_TEMPERATURE
                        if attempt == 0
                        else min(RETRY_MAX_TEMPERATURE, GENERATION_TEMPERATURE + RETRY_TEMPERATURE_STEP * attempt)
                    )
                    print(
                        f"{log_prefix} chunk {chunk_idx} tentative {attempt} (temp={temp_used:.2f}) : "
                        f'texte="{chunk_text[:60]}{"…" if len(chunk_text) > 60 else ""}" '
                        f"rms={rms:.4f} f0={f0:.1f}Hz dead_air={dead_air} "
                        f"whisper_similarite={'n/a' if similarity is None else f'{similarity:.2f}'} "
                        f'transcrit="{transcript[:60]}{"…" if len(transcript) > 60 else ""}" '
                        f"off_register={off_register} -> {'RETRY' if (degenerate or off_register) and attempt < CHUNK_RETRY_MAX_ATTEMPTS else 'ACCEPTE'}"
                    )

                    best_seg = trimmed
                    if not degenerate and not off_register:
                        if f0 > 0:
                            lesson_f0_history.append(f0)
                        break
                    if attempt == CHUNK_RETRY_MAX_ATTEMPTS:
                        # Dernière tentative acceptée telle quelle (mieux qu'un
                        # silence total) — mais on n'enrichit PAS la médiane
                        # avec une valeur qu'on sait suspecte.
                        print(f"{log_prefix} chunk {chunk_idx} : tentatives épuisées, accepté malgré la dégénérescence détectée")
                        break
                    total_retries += 1
                trimmed_pieces.append(best_seg if best_seg is not None and best_seg.size > 0 else np.zeros(1, dtype=np.float32))

            # Assemblage (correctif 4) : bords déjà trimés, RMS ré-normalisée
            # par chunk (cible = RMS médiane des chunks validés — évite qu'un
            # chunk anormalement fort/faible ne saute au raccord), crossfade
            # court entre chunks, gap de respiration entre PHRASES distinctes
            # (le crossfade gère le raccord fin, le gap garde le phrasé naturel).
            valid_rms = [r for r in (_rms(p) for p in trimmed_pieces) if r > CHUNK_MIN_RMS]
            target_rms = float(np.median(valid_rms)) if valid_rms else 0.0
            normalized = []
            for seg in trimmed_pieces:
                r = _rms(seg)
                if r > CHUNK_MIN_RMS and target_rms > 0:
                    seg = seg * (target_rms / r)
                normalized.append(seg)

            gap = np.zeros(int(sr * GAP_SECONDS), dtype=np.float32)
            sequence = []
            for i, seg in enumerate(normalized):
                if i > 0:
                    sequence.append(gap)
                sequence.append(seg)
            audio = _crossfade_concat(sequence, sr) if sequence else np.zeros(1, dtype=np.float32)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        print(
            f"{log_prefix} terminé : {len(chunks_preview)} chunk(s), {total_retries} retry(s), "
            f"{audio.size / sr:.1f}s audio, {time.time() - t_start:.1f}s écoulées"
        )
        return Response(content=buf.getvalue(), media_type="audio/wav")


@app.local_entrypoint()
def main():
    # Sanity local (n'exécute pas la génération, valide juste l'import du module).
    print("App Chatterbox définie. Déploiement : modal deploy modal/chatterbox_tts.py")
