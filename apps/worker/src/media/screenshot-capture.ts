// Capture d'écran automatique (Prompt 21) — cœur technique.
// Rejoue une TpScreenshotSpec (contrat @sallycourse/shared) dans un contexte
// Playwright isolé, avec garde SSRF stricte, puis produit la capture BRUTE
// (pleine page ou élément focalisé). L'habillage éditorial (annotateScreenshot
// + composition sharp) et la persistance vivent dans le processor associé.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { TpScreenshotAction, TpScreenshotSpec } from '../shared.js';

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
