// Prompt 22 — Pont entre une étape de TP et un environnement dockerisé.
//
// Contrat d'intégration avec la capture d'écran (screenshot-capture, P21) :
//   - étape avec screenshotSpec.url        → aucun conteneur (kind='web'),
//     la capture navigue directement vers l'URL ;
//   - étape avec `command` mais sans `url` → environnement 'terminal' (ttyd) :
//     on démarre le conteneur, on exécute la commande, puis la capture cible
//     l'URL du terminal web ;
//   - étape sans command ni url            → non illustrable ici (retour null).
//
// Si Docker est indisponible, on SKIPPE proprement (retour d'un résultat
// { skipped:true, reason }) : le job de capture ne doit PAS échouer, il se
// contente de logguer un warning et de sauter l'illustration de l'étape.
import type { Browser } from 'playwright';
import type { TpScreenshotSpec, TpStep } from '../shared.js';
import { logger } from '../queues/index.js';
import {
  DockerUnavailableError,
  startTpEnvironment,
  type TpEnvironment,
} from './tp-environments.js';
import { captureFromSpec, type CapturedScreenshot } from './screenshot-capture.js';

/** Résultat de la résolution d'environnement pour une étape de TP. */
export type TpStepEnvironmentResult =
  | { skipped: true; reason: string }
  | { skipped: false; env: TpEnvironment; commandOutput?: string };

/**
 * Prépare l'environnement de capture d'une étape de TP.
 *
 * L'appelant (screenshot-capture) doit :
 *   1. appeler cette fonction ;
 *   2. si `skipped` → logguer et passer à l'étape suivante sans échouer ;
 *   3. sinon → capturer `result.env.url` (avec les annotations D9), puis
 *      TOUJOURS appeler `result.env.stop()` dans un finally.
 */
export async function resolveTpStepEnvironment(
  step: TpStep,
): Promise<TpStepEnvironmentResult> {
  const specUrl = step.screenshotSpec?.url;

  // Cas 1 : l'étape pointe une URL → capture web directe, aucun conteneur.
  if (specUrl) {
    const env = await startTpEnvironment('web', { url: specUrl });
    return { skipped: false, env };
  }

  // Cas 2 : commande sans URL → terminal dockerisé, on exécute la commande.
  if (step.command) {
    let env: TpEnvironment;
    try {
      env = await startTpEnvironment('terminal');
    } catch (err) {
      if (err instanceof DockerUnavailableError) {
        logger.warn(
          { command: step.command, err },
          'Docker indisponible — capture de l\'étape TP sautée',
        );
        return { skipped: true, reason: 'docker-unavailable' };
      }
      throw err;
    }
    try {
      const commandOutput = await env.exec(step.command);
      return { skipped: false, env, commandOutput };
    } catch (err) {
      // Toute erreur après démarrage → cleanup garanti avant de propager.
      await env.stop();
      throw err;
    }
  }

  // Cas 3 : rien à illustrer via un environnement.
  return { skipped: true, reason: 'no-command-or-url' };
}

/** Résultat d'une capture d'étape orchestrée de bout en bout. */
export type TpStepCaptureResult =
  | { skipped: true; reason: string }
  | { skipped: false; screenshot: CapturedScreenshot; commandOutput?: string };

/**
 * Orchestration complète d'une étape de TP : provisionne l'environnement,
 * capture le rendu, puis nettoie — cleanup GARANTI (finally).
 *
 * - étape avec `screenshotSpec` → on rejoue ce spec (l'environnement 'web'
 *   éventuellement démarré ne fait que valider l'URL de départ) ;
 * - étape avec `command` sans spec → environnement terminal, exécution de la
 *   commande, puis capture pleine page de l'URL ttyd (loopback de confiance,
 *   exempté de la garde SSRF puisque provisionné par nous).
 *
 * Docker indisponible → { skipped:true } (le job de capture ne doit pas échouer).
 */
export async function captureTpStep(
  browser: Browser,
  step: TpStep,
): Promise<TpStepCaptureResult> {
  const resolved = await resolveTpStepEnvironment(step);
  if (resolved.skipped) return resolved;

  const { env, commandOutput } = resolved;
  try {
    // Spec de capture : le spec du step s'il existe, sinon capture directe de
    // l'URL de l'environnement (terminal web) marquée comme loopback de confiance.
    const spec: TpScreenshotSpec = step.screenshotSpec ?? {
      url: env.url,
      actions: [],
      caption: step.instruction,
    };
    const trustedLoopback = new Set<string>([env.url]);
    const screenshot = await captureFromSpec(browser, spec, { trustedLoopback });
    return { skipped: false, screenshot, commandOutput };
  } finally {
    await env.stop();
  }
}
