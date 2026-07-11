// Capture d'écran automatique (Prompt 21) — cœur technique.
// Rejoue une TpScreenshotSpec (contrat @sallycourse/shared) dans un contexte
// Playwright isolé, avec garde SSRF stricte, puis produit la capture BRUTE
// (pleine page ou élément focalisé). L'habillage éditorial (annotateScreenshot
// + composition sharp) et la persistance vivent dans le processor associé.
//
// Prompt 85 — Mode screencast : quand spec.recordVideo est vrai, au lieu d'une
// capture image unique, on rejoue la spec en enregistrant une VIDÉO native
// Playwright (context.recordVideo, pas de nouvelle dépendance), puis on
// post-traite avec ffmpeg :
//   1. zoom automatique (filtre zoompan) sur la zone de focusSelector, si
//      connue au moment de l'enregistrement (mesurée AVANT la fermeture du
//      contexte, car recordVideo écrit le fichier à la fermeture) ;
//   2. narration TTS synchronisée, concaténée en piste audio par-dessus le
//      screencast muet (réutilise synthesizeSlide de tts.ts).
// Les helpers de construction d'arguments ffmpeg sont PURS (testables sans
// navigateur ni binaire ffmpeg réel) ; seule renderScreencastFromSpec fait de
// l'I/O (Playwright + ffmpeg + TTS).
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { TpScreenshotAction, TpScreenshotSpec } from '../shared.js';

/**
 * Hash déterministe d'une TpScreenshotSpec (Prompt 72) : deux leçons — dans le
 * même cours ou dans des cours différents — qui rejouent EXACTEMENT la même
 * spec (url, actions, focusSelector, caption) produisent la même clé, ce qui
 * permet de réutiliser la capture déjà annotée au lieu de relancer Playwright.
 * La légende fait partie du hash car elle est composée DANS l'image annotée.
 */
export function hashScreenshotSpec(spec: TpScreenshotSpec): string {
  const normalized = JSON.stringify({
    url: spec.url ?? null,
    focusSelector: spec.focusSelector ?? null,
    caption: spec.caption,
    actions: spec.actions.map((a) => ({
      type: a.type,
      selector: a.selector ?? null,
      value: a.value ?? null,
    })),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

/** Résolution du viewport de capture — Full HD, aligné sur les slides D7/D8. */
export const CAPTURE_VIEWPORT = { width: 1920, height: 1080 } as const;
/** Budget global d'une capture (navigation + actions + stabilité + shot). */
export const CAPTURE_TIMEOUT_MS = 45_000;
/** Marge de stabilité après networkidle (rendu tardif, animations courtes). */
const STABILITY_SETTLE_MS = 500;

/** Erreur de capture enrichie de l'URL fautive pour le rapport GenerationJob. */
export class ScreenshotCaptureError extends Error {
  readonly url: string | undefined;
  constructor(message: string, url?: string) {
    super(message);
    this.name = 'ScreenshotCaptureError';
    this.url = url;
  }
}

/* ------------------------------------------------------------------ */
/* Garde SSRF — refuse localhost / IP privées / métadonnées cloud      */
/* ------------------------------------------------------------------ */

/** Vrai si l'IP (v4 ou v6) est privée, loopback, lien-local ou métadonnée cloud. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // lien-local + 169.254.169.254 (métadonnées)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast + réservé
    return false;
  }
  if (version === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true; // loopback / non spécifié
    if (low.startsWith('fe80')) return true; // lien-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local fc00::/7
    // IPv4 mappée (::ffff:a.b.c.d) : on revalide la partie v4.
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // ni v4 ni v6 : on refuse par prudence.
}

/**
 * Valide une URL de capture : schéma http/https uniquement, hôte non vide,
 * et TOUTES les IP résolues du hôte hors plages privées/métadonnées.
 * Jette une ScreenshotCaptureError explicite si l'URL est interdite.
 *
 * `trustedLoopback` : URLs de loopback provisionnées par le worker lui-même
 * (environnements TP dockerisés P22, publiés sur 127.0.0.1:<port>). Elles
 * échappent à la garde SSRF car leur origine est maîtrisée, PAS issue du LLM.
 */
export async function assertUrlAllowed(rawUrl: string, trustedLoopback?: ReadonlySet<string>): Promise<void> {
  if (trustedLoopback?.has(rawUrl)) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ScreenshotCaptureError(`URL invalide : « ${rawUrl} »`, rawUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ScreenshotCaptureError(`schéma « ${parsed.protocol} » refusé (http/https requis)`, rawUrl);
  }
  const host = parsed.hostname;
  if (!host) throw new ScreenshotCaptureError('hôte absent', rawUrl);

  // Refus immédiat des noms d'hôte évidents (avant même la résolution DNS).
  const loweredHost = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (loweredHost === 'localhost' || loweredHost.endsWith('.localhost')) {
    throw new ScreenshotCaptureError(`hôte local refusé : « ${host} »`, rawUrl);
  }

  // Si l'hôte est déjà une IP littérale, on la valide directement.
  if (isIP(loweredHost)) {
    if (isBlockedIp(loweredHost)) {
      throw new ScreenshotCaptureError(`IP privée/réservée refusée : ${loweredHost}`, rawUrl);
    }
    return;
  }

  // Sinon on résout et on vérifie CHAQUE adresse (anti rebind partiel).
  let addresses: { address: string }[];
  try {
    addresses = await lookup(loweredHost, { all: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ScreenshotCaptureError(`résolution DNS impossible pour « ${host} » — ${reason}`, rawUrl);
  }
  if (addresses.length === 0) {
    throw new ScreenshotCaptureError(`aucune IP résolue pour « ${host} »`, rawUrl);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new ScreenshotCaptureError(
        `« ${host} » résout vers une IP privée/réservée (${address}) — refusé`,
        rawUrl,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rejeu des actions                                                   */
/* ------------------------------------------------------------------ */

/** Borne une valeur numérique de spec (scroll/wait) avec repli sûr. */
function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Exécute une action de spec sur la page. Les gotos passent par la garde SSRF
 * (une spec peut naviguer plusieurs fois). `perActionTimeout` borne chaque
 * attente Playwright pour ne jamais dépasser le budget global.
 */
async function runAction(
  page: Page,
  action: TpScreenshotAction,
  perActionTimeout: number,
  trustedLoopback?: ReadonlySet<string>,
): Promise<void> {
  switch (action.type) {
    case 'goto': {
      const url = action.value as string; // garanti par le schéma (goto ⇒ value)
      await assertUrlAllowed(url, trustedLoopback);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: perActionTimeout });
      break;
    }
    case 'click': {
      await page.click(action.selector as string, { timeout: perActionTimeout });
      break;
    }
    case 'fill': {
      await page.fill(action.selector as string, action.value as string, { timeout: perActionTimeout });
      break;
    }
    case 'scroll': {
      const px = toPositiveInt(action.value, 300);
      // Le callback est sérialisé et exécuté DANS le contexte navigateur : il ne
      // peut capturer aucune variable Node. `scrollBy` y existe (globalThis du
      // navigateur), typé localement pour satisfaire tsc sans lib DOM.
      await page.evaluate((y) => {
        (globalThis as unknown as { scrollBy(x: number, yy: number): void }).scrollBy(0, y);
      }, px);
      break;
    }
    case 'wait': {
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: perActionTimeout });
      } else {
        const ms = Math.min(toPositiveInt(action.value, 1000), perActionTimeout);
        await page.waitForTimeout(ms);
      }
      break;
    }
    default: {
      // Exhaustivité : tout nouveau type d'action doit être géré explicitement.
      const never: never = action.type;
      throw new ScreenshotCaptureError(`action de capture inconnue : « ${String(never)} »`);
    }
  }
}

/** Attend la stabilité de la page : networkidle (best-effort) + délai de repos. */
async function waitForStability(page: Page, deadline: number): Promise<void> {
  const remaining = Math.max(0, deadline - Date.now());
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(remaining, 10_000) });
  } catch {
    // Pages à connexions longues (websockets, polling) : networkidle jamais
    // atteint — on n'échoue pas la capture pour autant.
  }
  await page.waitForTimeout(STABILITY_SETTLE_MS);
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

export interface CapturedScreenshot {
  /** PNG brut de la capture (pleine page ou élément). */
  buffer: Buffer;
  /** Dimensions réelles du PNG (pilotent la géométrie d'annotation). */
  width: number;
  height: number;
}

/** Décode les dimensions d'un PNG depuis son en-tête IHDR (octets 16-24). */
export function readPngSize(buffer: Buffer): { width: number; height: number } {
  const PNG_SIGNATURE = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new ScreenshotCaptureError('capture illisible : signature PNG absente');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Rejoue une spec dans un contexte isolé et renvoie la capture BRUTE.
 * Le browser est fourni par l'appelant (mutualisé sur toute une leçon) ;
 * le contexte, lui, est créé/détruit par capture pour l'isolation.
 */
export interface CaptureOptions {
  /**
   * URLs de loopback de confiance (environnements TP dockerisés P22) exemptées
   * de la garde SSRF — voir assertUrlAllowed.
   */
  trustedLoopback?: ReadonlySet<string>;
}

export async function captureFromSpec(
  browser: Browser,
  spec: TpScreenshotSpec,
  options: CaptureOptions = {},
): Promise<CapturedScreenshot> {
  const { trustedLoopback } = options;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const perActionTimeout = (): number => Math.max(1_000, deadline - Date.now());

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { ...CAPTURE_VIEWPORT },
      deviceScaleFactor: 1,
      // Contexte neuf sans stockage : aucune fuite d'état entre captures.
      ignoreHTTPSErrors: false,
    });
    context.setDefaultTimeout(CAPTURE_TIMEOUT_MS);
    const page = await context.newPage();

    // Page de départ : url explicite (validée) ou première action goto (validée).
    if (spec.url) {
      await assertUrlAllowed(spec.url, trustedLoopback);
      await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: perActionTimeout() });
    }

    for (const action of spec.actions) {
      if (Date.now() >= deadline) {
        throw new ScreenshotCaptureError('budget de capture épuisé pendant le rejeu des actions', spec.url);
      }
      await runAction(page, action, perActionTimeout(), trustedLoopback);
    }

    await waitForStability(page, deadline);

    // Capture ciblée sur focusSelector s'il est présent et visible, sinon pleine page.
    let buffer: Buffer;
    if (spec.focusSelector) {
      const locator = page.locator(spec.focusSelector).first();
      const count = await locator.count();
      if (count > 0) {
        buffer = await locator.screenshot({ timeout: perActionTimeout() });
      } else {
        buffer = await page.screenshot({ fullPage: true, timeout: perActionTimeout() });
      }
    } else {
      buffer = await page.screenshot({ fullPage: true, timeout: perActionTimeout() });
    }

    const { width, height } = readPngSize(buffer);
    return { buffer, width, height };
  } catch (err) {
    if (err instanceof ScreenshotCaptureError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ScreenshotCaptureError(`capture échouée — ${reason}`, spec.url);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/** Lance un navigateur Chromium headless mutualisé pour une salve de captures. */
export async function launchCaptureBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/* ------------------------------------------------------------------ */
/* Mode screencast (Prompt 85)                                         */
/* ------------------------------------------------------------------ */

/** Vrai si la spec doit être rejouée en screencast (vidéo) plutôt qu'en capture image simple. */
export function isScreencastSpec(spec: TpScreenshotSpec): boolean {
  return spec.recordVideo === true;
}

/** Rectangle en pixels (coordonnées de la vidéo source), borné à des entiers pairs. */
export interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options de construction du filtre zoompan ffmpeg. */
export interface ZoompanOptions {
  /** Dimensions de la vidéo source (screencast Playwright). */
  sourceWidth: number;
  sourceHeight: number;
  /** Zone à mettre en évidence — absente ⇒ pas de zoom (aucun filtre nécessaire). */
  focusRect?: FocusRect;
  /** Nombre total de frames de sortie (fps de sortie × durée). */
  totalFrames: number;
  /** Cadence de sortie (images/seconde). */
  fps: number;
  /** Facteur de zoom cible sur la zone focus (1 = pas de zoom). */
  zoomFactor?: number;
}

/** Facteur de zoom par défaut appliqué sur la zone de focus. */
export const DEFAULT_ZOOM_FACTOR = 1.6;
/** Fraction de la durée totale consacrée à la montée en zoom (ease-in), le reste tient le cadrage. */
const ZOOM_RAMP_FRACTION = 0.25;

/**
 * Construit l'expression du filtre ffmpeg `zoompan` qui zoome progressivement
 * vers `focusRect` puis tient le cadrage jusqu'à la fin du clip. Pur : aucune
 * I/O, testable indépendamment de ffmpeg/Playwright. Retourne `null` si aucun
 * focusRect n'est fourni (rien à zoomer — le screencast reste en cadrage large).
 *
 * Approche : zoompan anime `z` (facteur de zoom) en rampe linéaire sur les
 * ZOOM_RAMP_FRACTION premières frames jusqu'à `zoomFactor`, puis le maintient.
 * `x`/`y` centrent la fenêtre de zoom sur le centre du focusRect, bornés pour
 * ne jamais sortir du cadre source (in_w/in_h disponibles dans l'expression).
 */
export function buildZoompanFilter(options: ZoompanOptions): string | null {
  const { sourceWidth, sourceHeight, focusRect, totalFrames, fps, zoomFactor = DEFAULT_ZOOM_FACTOR } = options;
  if (!focusRect || totalFrames <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return null;

  const rampFrames = Math.max(1, Math.round(totalFrames * ZOOM_RAMP_FRACTION));
  const centerX = focusRect.x + focusRect.width / 2;
  const centerY = focusRect.y + focusRect.height / 2;

  // z : 1 → zoomFactor en rampe linéaire sur rampFrames, puis plateau.
  const zExpr = `min(1+((${zoomFactor.toFixed(3)}-1)/${rampFrames})*on,${zoomFactor.toFixed(3)})`;
  // x/y : centre la fenêtre de zoom sur le focusRect, borné dans [0, in_w-iw] / [0, in_h-ih].
  const xExpr = `min(max(${centerX.toFixed(1)}-(iw/2),0),iw*${zoomFactor.toFixed(3)}-iw)`;
  const yExpr = `min(max(${centerY.toFixed(1)}-(ih/2),0),ih*${zoomFactor.toFixed(3)}-ih)`;

  return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${sourceWidth}x${sourceHeight}:fps=${fps}`;
}

/**
 * Arguments ffmpeg complets pour post-traiter un screencast brut : applique
 * (optionnellement) le zoom automatique sur focusRect, réencode en H.264, et
 * mixe la piste de narration si fournie (`-shortest` cale la sortie sur le
 * plus court des deux flux, la vidéo étant normalement plus longue).
 * Pur : construit uniquement le tableau d'arguments, aucune exécution ici.
 */
export function buildScreencastPostProcessArgs(params: {
  inputVideo: string;
  narrationAudio?: string;
  output: string;
  sourceWidth: number;
  sourceHeight: number;
  focusRect?: FocusRect;
  durationSeconds: number;
  fps?: number;
  zoomFactor?: number;
}): string[] {
  const fps = params.fps ?? 30;
  const totalFrames = Math.max(1, Math.round(params.durationSeconds * fps));
  const zoom = buildZoompanFilter({
    sourceWidth: params.sourceWidth,
    sourceHeight: params.sourceHeight,
    focusRect: params.focusRect,
    totalFrames,
    fps,
    zoomFactor: params.zoomFactor,
  });

  const args: string[] = ['-y', '-i', params.inputVideo];
  if (params.narrationAudio) {
    args.push('-i', params.narrationAudio);
  }

  const vf = zoom ?? `scale=${params.sourceWidth}:${params.sourceHeight},fps=${fps}`;
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');

  if (params.narrationAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-map', '0:v:0', '-map', '1:a:0', '-shortest');
  } else {
    args.push('-an');
  }
  args.push(params.output);
  return args;
}

/** Résultat d'un screencast rendu : vidéo muxée + focusRect mesuré (diagnostic). */
export interface CapturedScreencast {
  /** Chemin local du MP4 final (zoom + narration éventuelle appliqués). */
  path: string;
  durationSeconds: number;
  focusRect?: FocusRect;
}

/**
 * Mesure le rectangle (page pixels, == vidéo pixels car deviceScaleFactor=1)
 * du focusSelector, si présent et visible. `null` si absent/introuvable —
 * le screencast reste alors en cadrage large (pas de zoom).
 */
async function measureFocusRect(page: Page, focusSelector?: string): Promise<FocusRect | undefined> {
  if (!focusSelector) return undefined;
  const locator = page.locator(focusSelector).first();
  if ((await locator.count()) === 0) return undefined;
  const box = await locator.boundingBox();
  if (!box) return undefined;
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

/**
 * Rejoue une spec en screencast : enregistre une vidéo Playwright native
 * (context.recordVideo) pendant le rejeu des actions, mesure le focusRect
 * avant de fermer le contexte (recordVideo n'écrit le fichier qu'à la
 * fermeture), puis retourne le .webm brut + le focusRect mesuré. Le
 * post-traitement (zoom + narration) est appliqué par l'appelant via
 * buildScreencastPostProcessArgs (séparation I/O brute vs. post-process pur).
 */
export async function captureScreencastFromSpec(
  browser: Browser,
  spec: TpScreenshotSpec,
  workDir: string,
  options: CaptureOptions = {},
): Promise<{ rawVideoPath: string; focusRect?: FocusRect }> {
  const { trustedLoopback } = options;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const perActionTimeout = (): number => Math.max(1_000, deadline - Date.now());

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { ...CAPTURE_VIEWPORT },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: false,
      recordVideo: { dir: workDir, size: { ...CAPTURE_VIEWPORT } },
    });
    context.setDefaultTimeout(CAPTURE_TIMEOUT_MS);
    const page = await context.newPage();

    if (spec.url) {
      await assertUrlAllowed(spec.url, trustedLoopback);
      await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: perActionTimeout() });
    }

    for (const action of spec.actions) {
      if (Date.now() >= deadline) {
        throw new ScreenshotCaptureError('budget de capture épuisé pendant le rejeu des actions', spec.url);
      }
      await runAction(page, action, perActionTimeout(), trustedLoopback);
    }

    await waitForStability(page, deadline);
    const focusRect = await measureFocusRect(page, spec.focusSelector);

    const video = page.video();
    await context.close();
    context = undefined;
    if (!video) {
      throw new ScreenshotCaptureError('enregistrement vidéo indisponible (recordVideo non initialisé)', spec.url);
    }
    const rawVideoPath = await video.path();
    return { rawVideoPath, focusRect };
  } catch (err) {
    if (err instanceof ScreenshotCaptureError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ScreenshotCaptureError(`screencast échoué — ${reason}`, spec.url);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * Orchestration complète d'un screencast : capture vidéo brute (Playwright),
 * synthèse de narration TTS (réutilise synthesizeSlide de tts.ts, mock-friendly
 * via MOCK_PROVIDERS/absence de clé), puis post-traitement ffmpeg (zoom +
 * mux narration). Retourne le MP4 final prêt à uploader.
 *
 * `narrationText` optionnel : sans texte, le screencast est rendu MUET (zoom
 * appliqué mais aucune piste audio) — cas d'une étape sans légende parlée.
 */
export async function renderScreencastFromSpec(
  browser: Browser,
  spec: TpScreenshotSpec,
  params: {
    narrationText?: string;
    locale?: string;
    voice?: string;
  } = {},
  options: CaptureOptions = {},
): Promise<CapturedScreencast> {
  const dir = await mkdtemp(path.join(tmpdir(), 'screencast-'));
  try {
    const { rawVideoPath, focusRect } = await captureScreencastFromSpec(browser, spec, dir, options);

    // Durée mesurée par ffprobe (le .webm Playwright ne porte pas de durée fiable en métadonnées simples).
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      rawVideoPath,
    ]);
    const durationSeconds = Number.parseFloat(stdout.trim()) || 1;

    // Narration optionnelle : réutilise le pipeline TTS existant (cache + repli silence).
    let narrationPath: string | undefined;
    if (params.narrationText && params.narrationText.trim()) {
      const { synthesizeSlide } = await import('./tts.js');
      const { getObjectStream } = await import('../shared.js');
      const synth = await synthesizeSlide({
        text: params.narrationText,
        locale: params.locale ?? 'fr',
        voice: params.voice,
      });
      narrationPath = path.join(dir, 'narration.mp3');
      const stream = await getObjectStream(synth.cacheKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await writeFile(narrationPath, Buffer.concat(chunks));
    }

    const finalPath = path.join(dir, 'screencast-final.mp4');
    const args = buildScreencastPostProcessArgs({
      inputVideo: rawVideoPath,
      narrationAudio: narrationPath,
      output: finalPath,
      sourceWidth: CAPTURE_VIEWPORT.width,
      sourceHeight: CAPTURE_VIEWPORT.height,
      focusRect,
      durationSeconds,
    });
    await execa('ffmpeg', args);

    // Déplace le résultat hors du dossier temporaire de travail (l'appelant nettoiera `dir`
    // après avoir lu le fichier — on renomme dans un chemin stable pour éviter une racecourse
    // avec un futur rm(dir) si l'appelant lit après coup).
    const stableDir = await mkdtemp(path.join(tmpdir(), 'screencast-out-'));
    const stablePath = path.join(stableDir, 'screencast.mp4');
    await rename(finalPath, stablePath);

    return { path: stablePath, durationSeconds, focusRect };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
