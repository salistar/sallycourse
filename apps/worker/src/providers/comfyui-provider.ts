// Illustrations de slides OSS via ComfyUI (Prompt 154).
//
// ComfyUI expose une API HTTP simple autour de son moteur de workflow (nœuds
// checkpoint → prompt CLIP → sampler → VAE decode → save image) :
//   POST /prompt        { prompt: <workflow JSON>, client_id } → { prompt_id }
//   GET  /history/{id}                                        → statut + noms de fichiers produits
//   GET  /view?filename=...&subfolder=...&type=output          → bytes PNG
// On construit ici un workflow JSON MINIMAL (texte→image, un seul sampler,
// pas d'upscale/ControlNet) ciblant un checkpoint FLUX.1-schnell (rapide, peu
// de steps) ou Stable Diffusion 1.5 en repli (STABLE_DIFFUSION_CHECKPOINT) —
// le nom de checkpoint réellement chargé dépend de ce qui est déposé dans le
// volume comfyui-models/checkpoints/ (non embarqué dans l'image, cf.
// docker-compose profil `ai`, service `comfyui`).
//
// Style verrouillé sur le design system : le prompt généré référence
// explicitement la palette SALISTAR (violet/or, cf. @sallycourse/design/tokens)
// et un vocabulaire de style fixe (illustration géométrique plate, dégradé
// violet profond, accents dorés) — jamais de style libre au choix du LLM.
//
// FALLBACK ZÉRO-GPU (comportement PAR DÉFAUT) : les illustrations SVG
// procédurales du design system (generateCourseImage, packages/design/
// marketing-assets.ts, P11/D11) ne dépendent d'aucun service externe et sont
// TOUJOURS disponibles. ComfyUI est une amélioration optionnelle : absent/
// MOCK_PROVIDERS actif → on ne l'appelle jamais, le SVG procédural sert
// directement l'illustration (voir shouldUseComfyUi + le point d'entrée
// generateSlideIllustration qui l'encapsule).
import { colors, generateCourseImage, getConfig, type CourseImageSpecInput } from '../shared.js';
import type { ImageProvider, ImageProviderCallOptions } from './types.js';

/** Checkpoints par défaut, du plus rapide (schnell) au repli qualité SD1.5. */
export const COMFYUI_DEFAULT_CHECKPOINT = 'flux1-schnell-fp8.safetensors';
export const COMFYUI_FALLBACK_CHECKPOINT = 'sd15-pruned-emaonly.safetensors';

/** Dimensions par défaut d'une illustration de slide (format paysage 16:9 léger). */
export const COMFYUI_DEFAULT_WIDTH = 1024;
export const COMFYUI_DEFAULT_HEIGHT = 576;

/** Vocabulaire de style FIXE — jamais de style libre, toujours ancré design system. */
const STYLE_SUFFIX =
  'flat geometric illustration, deep violet gradient background ' +
  `(${colors.violet[900]} to ${colors.violet[600]}), warm gold accents (${colors.gold[400]}), ` +
  'minimalist vector shapes, soft lighting, no text, no watermark, professional e-learning aesthetic';

/** Termes à bannir explicitement (négatif) — évite les dérives de style courantes. */
const NEGATIVE_PROMPT =
  'photorealistic, text, watermark, signature, blurry, low quality, cluttered, ' +
  'neon colors, clashing colors, distorted anatomy';

export interface ComfyUiWorkflowInput {
  /** Sujet de l'illustration (ex: résumé de la slide, concept clé). */
  subject: string;
  width?: number;
  height?: number;
  /** Checkpoint explicite (sinon COMFYUI_DEFAULT_CHECKPOINT). */
  checkpoint?: string;
  /** Seed déterministe (mêmes entrées → même image) ; sinon dérivée du sujet. */
  seed?: number;
}

/** Hash FNV-1a 32 bits — dérive une seed déterministe du sujet si non fournie. */
function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Construit le prompt positif final : sujet + style verrouillé design system. */
export function buildComfyUiPrompt(subject: string): string {
  const cleanSubject = subject.trim().replace(/\s+/g, ' ').slice(0, 300);
  return `${cleanSubject}, ${STYLE_SUFFIX}`;
}

/**
 * Construit le workflow JSON minimal ComfyUI (texte→image, un sampler) pour
 * l'API /prompt. Fonction PURE — aucun I/O — testable indépendamment de la
 * disponibilité du service.
 *
 * Graphe de nœuds (identifiants stables, requis par l'API ComfyUI) :
 *   1. CheckpointLoaderSimple → modèle/clip/vae
 *   2. CLIPTextEncode (positif)  — prompt verrouillé design system
 *   3. CLIPTextEncode (négatif)  — NEGATIVE_PROMPT
 *   4. EmptyLatentImage          — dimensions demandées
 *   5. KSampler                  — peu de steps (schnell : 4 suffisent)
 *   6. VAEDecode
 *   7. SaveImage
 */
export function buildComfyUiWorkflow(input: ComfyUiWorkflowInput): Record<string, unknown> {
  const width = input.width && input.width > 0 ? input.width : COMFYUI_DEFAULT_WIDTH;
  const height = input.height && input.height > 0 ? input.height : COMFYUI_DEFAULT_HEIGHT;
  const checkpoint = input.checkpoint?.trim() || COMFYUI_DEFAULT_CHECKPOINT;
  const seed = input.seed ?? hashSeed(input.subject);
  const isSchnell = checkpoint.toLowerCase().includes('schnell');

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: buildComfyUiPrompt(input.subject), clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: NEGATIVE_PROMPT, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        // FLUX.1-schnell est distillé pour un rendu correct en 4 steps (CFG=1,
        // sampler euler) ; SD1.5 a besoin de davantage d'itérations (20, CFG=7).
        steps: isSchnell ? 4 : 20,
        cfg: isSchnell ? 1 : 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'sallycourse-slide' },
    },
  };
}

/** URL de base ComfyUI, surchargeable (.env / mock-server en test). */
function comfyUiBaseUrl(): string | undefined {
  const raw = getConfig().COMFYUI_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : undefined;
}

/** true si un endpoint ComfyUI est configuré ET que le mode mock global n'est pas actif. */
export function isComfyUiConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && Boolean(comfyUiBaseUrl());
}

interface ComfyUiHistoryEntry {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}

/** Attend la fin du job ComfyUI (polling /history/{id}) et renvoie le premier PNG produit. */
async function pollComfyUiResult(base: string, promptId: string, timeoutMs: number): Promise<Buffer> {
  const start = Date.now();
  const pollIntervalMs = 1000;

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/history/${encodeURIComponent(promptId)}`);
    if (res.ok) {
      const history = (await res.json()) as Record<string, ComfyUiHistoryEntry>;
      const entry = history[promptId];
      const outputs = entry?.outputs ? Object.values(entry.outputs) : [];
      const image = outputs.flatMap((o) => o.images ?? [])[0];
      if (image) {
        const params = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder,
          type: image.type,
        });
        const viewRes = await fetch(`${base}/view?${params.toString()}`);
        if (!viewRes.ok) {
          throw new Error(`ComfyUI /view ${viewRes.status} : impossible de récupérer ${image.filename}`);
        }
        return Buffer.from(await viewRes.arrayBuffer());
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`ComfyUI : délai dépassé (${timeoutMs}ms) sans image produite pour ${promptId}`);
}

/** Délai maximal d'attente d'une génération ComfyUI (GPU local, quelques secondes en pratique). */
const COMFYUI_TIMEOUT_MS = 60_000;

/**
 * Génère une illustration PNG via ComfyUI (texte→image). Jette une erreur
 * explicite en cas d'échec réseau/HTTP/timeout — c'est l'appelant qui décide
 * du repli (SVG procédural), ComfyUI n'a pas connaissance de la chaîne globale.
 */
export async function generateComfyUiImage(input: ComfyUiWorkflowInput): Promise<Buffer> {
  const base = comfyUiBaseUrl();
  if (!base) {
    throw new Error('ComfyUI : COMFYUI_BASE_URL non configurée');
  }
  const workflow = buildComfyUiWorkflow(input);
  const clientId = `sallycourse-${Date.now().toString(36)}`;

  const res = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`ComfyUI /prompt ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { prompt_id?: string };
  if (!data.prompt_id) {
    throw new Error('ComfyUI /prompt : réponse sans prompt_id');
  }
  return pollComfyUiResult(base, data.prompt_id, COMFYUI_TIMEOUT_MS);
}

// ── Point d'entrée unique : illustration de slide avec repli garanti ──────

export interface SlideIllustrationInput {
  /** Titre du cours (seed du motif SVG procédural si ComfyUI est indisponible). */
  courseTitle: string;
  /** Sujet/résumé de la slide — pilote le prompt ComfyUI. */
  slideSubject: string;
  /** Langue d'affichage (repli SVG uniquement — RTL/police). */
  lang?: CourseImageSpecInput['lang'];
}

export interface SlideIllustrationResult {
  /** Bytes de l'image produite. */
  buffer: Buffer;
  /** Format des bytes ('png' via ComfyUI, 'svg' via le repli procédural). */
  format: 'png' | 'svg';
  /** Provider ayant réellement produit l'illustration. */
  provider: 'comfyui' | 'procedural-svg';
}

/**
 * Illustration alternative de slide : tente ComfyUI si configuré, sinon (ou en
 * cas d'échec) retombe SANS EXCEPTION sur le SVG géométrique procédural du
 * design system (P11/D11, generateCourseImage au format 'og' — même ratio
 * qu'une illustration de slide). C'est ce point d'entrée que les processors
 * doivent appeler, jamais generateComfyUiImage directement.
 */
export async function generateSlideIllustration(
  input: SlideIllustrationInput,
): Promise<SlideIllustrationResult> {
  if (isComfyUiConfigured()) {
    try {
      const buffer = await generateComfyUiImage({ subject: input.slideSubject });
      return { buffer, format: 'png', provider: 'comfyui' };
    } catch {
      // ComfyUI indisponible/en échec : repli silencieux, jamais bloquant.
      // (pas de logger ici pour garder ce module sans dépendance à queues/ ;
      // l'appelant orchestrant l'I/O est le bon endroit pour logger l'échec.)
    }
  }

  const svg = generateCourseImage({
    title: input.courseTitle,
    seed: input.slideSubject,
    format: 'og',
    lang: input.lang ?? 'fr',
  });
  return { buffer: Buffer.from(svg, 'utf-8'), format: 'svg', provider: 'procedural-svg' };
}

// ── Conformité au contrat ImageProvider (providers/types.ts, Prompt 151) ──

/**
 * Implémentation ImageProvider pour ComfyUI — expose le contrat générique
 * `generate(prompt, opts)` attendu par le registre (registry.ts::selectProvider,
 * kind 'image'). Jette si ComfyUI n'est pas configuré : c'est à l'appelant
 * (generateSlideIllustration, ou tout futur générateur métier) de retomber
 * sur l'ImageProvider procédural (image-svg, cf. generateCourseImage) selon
 * le même contrat — jamais à CE provider de le faire lui-même (cohérent avec
 * piper-provider.ts / sadtalker-provider.ts : chaque provider concret jette,
 * l'orchestration du repli reste chez l'appelant).
 */
export const comfyUiImageProvider: ImageProvider = {
  name: 'comfyui',
  async generate(prompt: string, _opts?: ImageProviderCallOptions): Promise<Buffer> {
    return generateComfyUiImage({ subject: prompt });
  },
};
