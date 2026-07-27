# Déploiement Modal — génération d'images Z-Image Turbo (Alibaba Tongyi-MAI,
# Apache-2.0, commercial OK). Ajout ADDITIF suite à l'audit qualité modèles du
# 2026-07-22 : Z-Image Turbo est classé n°1 des modèles open-weights (Artificial
# Analysis Image Arena), génère en ~8 étapes (vs 28 pour SDXL — bien moins cher
# sur Modal) et note mieux en réalisme/esthétique dans les comparatifs publics.
# Ce fichier ne modifie ni ne remplace image_gen.py (SDXL) : les deux endpoints
# coexistent, le worker choisit via Course.imageEngine / le bouton « switch »
# par slide (voir media/image-generation.ts, providers/zimage-provider.ts).
#
# Déploiement :   modal deploy modal/zimage_turbo.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) — MÊME CONTRAT que SDXL
# pour un branchement trivial côté worker :
#   POST {url}  JSON { prompt, negative_prompt?, width?, height?, steps?, seed? }
#     ->  image/png
#
# GPU L4, scale-à-zéro après 5 min (coût uniquement à l'usage).
#
# ── Particularité de déploiement : diffusers doit être installé depuis SOURCE
# `ZImagePipeline` n'est pas encore dans une release PyPI stable de diffusers
# (au 2026-07-22) — installation depuis le dépôt GitHub, comme documenté par
# Hugging Face. `negative_prompt`/CFG sont IGNORÉS par le modèle Turbo (la
# distillation est conçue pour `guidance_scale=0.0` — le paramètre est accepté
# côté endpoint pour garder un contrat IDENTIQUE à SDXL, mais silencieusement
# sans effet ici, documenté dans le code ci-dessous plutôt que dans une erreur).
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-zimage")


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 1360
    height: int = 768
    steps: int = 28
    seed: Optional[int] = None


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install("torch", "accelerate", "safetensors", "sentencepiece", "fastapi[standard]")
    # ZImagePipeline pas encore publié sur PyPI (diffusers) — install source.
    .pip_install("git+https://github.com/huggingface/diffusers")
    .pip_install("transformers")
)

# Même volume que les autres apps Modal SallyCourse : cache HF partagé.
hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

MODEL_ID = "Tongyi-MAI/Z-Image-Turbo"

# Réglages figés du modèle Turbo (distillé pour CE point de fonctionnement
# précis — les faire varier dégraderait la qualité, contrairement à SDXL) :
# 9 étapes (8 forwards DiT) et guidance nulle, recommandés par le model card.
TURBO_STEPS = 9
TURBO_GUIDANCE_SCALE = 0.0


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=600,
)
class ZImageTurbo:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import ZImagePipeline

        self.pipe = ZImagePipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=False,
        ).to("cuda")

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def generate(self, req: ImageRequest):
        import io

        import torch
        from fastapi import Response

        prompt = (req.prompt or "").strip()
        if not prompt:
            return Response(
                content=b'{"error":"prompt vide"}',
                media_type="application/json",
                status_code=400,
            )

        # Bornes de sécurité — mêmes que image_gen.py (contrat identique).
        w = max(512, min(1536, (req.width // 8) * 8))
        h = max(512, min(1536, (req.height // 8) * 8))

        generator = None
        if req.seed is not None:
            generator = torch.Generator(device="cuda").manual_seed(int(req.seed))

        # `steps`/`negative_prompt` du contrat commun sont volontairement
        # ignorés : le point de fonctionnement Turbo (9 étapes, guidance 0)
        # est celui pour lequel le modèle a été distillé, pas un réglage libre.
        result = self.pipe(
            prompt=prompt,
            height=h,
            width=w,
            num_inference_steps=TURBO_STEPS,
            guidance_scale=TURBO_GUIDANCE_SCALE,
            generator=generator,
        )
        img = result.images[0]

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")


@app.local_entrypoint()
def main():
    print("App Z-Image Turbo définie. Déploiement : modal deploy modal/zimage_turbo.py")
