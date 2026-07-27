# Déploiement Modal — génération d'images (SDXL) sur GPU.
# Remplace les miniatures SVG géométriques par de VRAIES images générées :
# cover art par cours, illustrations de leçons, hero du blog SEO, visuels de
# bande-annonce. SDXL (7 Go, Apache/OpenRAIL, pas de gating) : fiable sur L4,
# qualité largement suffisante pour des visuels de cours.
#
# Déploiement :   modal deploy modal/image_gen.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) attendu par le worker :
#   POST {url}  JSON { prompt, negative_prompt?, width?, height?, steps?, seed? }
#     ->  image/png
#
# GPU L4, scale-à-zéro après 5 min (coût uniquement à l'usage).
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-imagegen")


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    # Défaut 16:9 (miniature de cours) — dimensions multiples de 8 compatibles SDXL.
    width: int = 1360
    height: int = 768
    steps: int = 28
    # Seed → reproductibilité (même cours = même image). None → aléatoire.
    seed: Optional[int] = None


# torch CUDA + diffusers. Pas de cuDNN système requis (torch embarque ses libs).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "diffusers==0.31.0",
        # transformers DOIT être épinglé : diffusers 0.31.0 importe encore
        # FLAX_WEIGHTS_NAME depuis transformers.utils, symbole SUPPRIMÉ par
        # transformers >= 4.48 → le conteneur crashait au chargement (@modal.enter),
        # d'où un 303 côté endpoint (jamais démarré). 4.46.3 = dernier compatible.
        "transformers==4.46.3",
        "accelerate",
        "safetensors",
        "sentencepiece",
        "fastapi[standard]",
    )
)

hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=600,
)
class ImageGen:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLPipeline

        self.pipe = StableDiffusionXLPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float16,
            use_safetensors=True,
            variant="fp16",
        )
        self.pipe.scheduler = DPMSolverMultistepScheduler.from_config(self.pipe.scheduler.config)
        self.pipe = self.pipe.to("cuda")
        # Un peu de VRAM en moins, pas de perte de qualité notable.
        self.pipe.enable_vae_tiling()

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

        # Bornes de sécurité : dimensions multiples de 8, plafonnées.
        w = max(512, min(1536, (req.width // 8) * 8))
        h = max(512, min(1536, (req.height // 8) * 8))
        steps = max(10, min(50, req.steps))

        generator = None
        if req.seed is not None:
            generator = torch.Generator(device="cuda").manual_seed(int(req.seed))

        result = self.pipe(
            prompt=prompt,
            negative_prompt=req.negative_prompt or None,
            width=w,
            height=h,
            num_inference_steps=steps,
            generator=generator,
        )
        img = result.images[0]

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")


@app.local_entrypoint()
def main():
    print("App ImageGen définie. Déploiement : modal deploy modal/image_gen.py")
