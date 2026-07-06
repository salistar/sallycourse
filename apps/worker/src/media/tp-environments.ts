// Prompt 22 — Environnements TP dockerisés.
//
// Pour illustrer les TPs techniques, on démarre des conteneurs éphémères de
// démonstration pilotés via le CLI docker (execa). Trois types :
//   - 'terminal' : image ttyd (terminal web) ; on exécute les commandes du TP
//     via `docker exec` puis on capture le rendu web servi par ttyd ;
//   - 'vscode'   : codercom/code-server sans authentification, port aléatoire ;
//   - 'web'      : aucun conteneur — l'URL est fournie par le TP lui-même.
//
// Réseau : tous les conteneurs rejoignent un réseau docker dédié
// 'sallycourse-tp' créé à la demande. Ce réseau est ISOLÉ des services internes
// du docker-compose (redis/mongo/minio) : il n'y est pas rattaché, donc un TP
// ne peut pas atteindre les services applicatifs. Voir README-tp-envs.md.
//
// Cycle de vie : readiness par polling HTTP (timeout 60 s), cleanup GARANTI via
// stop() (et un reaper killTpContainersOlderThan pour les fuites éventuelles).
// Si Docker est indisponible, les fonctions échouent proprement — l'appelant
// (screenshot-capture) doit traiter ce cas comme un skip, pas comme une erreur.
import { execa, type ExecaError } from 'execa';
import { nanoid } from 'nanoid';
import { logger } from '../queues/index.js';

/** Types d'environnements de démonstration supportés. */
export type TpEnvironmentKind = 'terminal' | 'vscode' | 'web';

/** Réseau docker dédié, isolé des services applicatifs internes. */
export const TP_NETWORK = 'sallycourse-tp';

/** Label appliqué à tous les conteneurs pour les retrouver / les faucher. */
export const TP_CONTAINER_LABEL = 'sallycourse.tp';

/** Images par défaut (surchargables via les options). */
const DEFAULT_IMAGES: Record<Exclude<TpEnvironmentKind, 'web'>, string> = {
  terminal: 'tsl0922/ttyd:latest',
  vscode: 'codercom/code-server:latest',
};

/** Port interne exposé par chaque image. */
const INTERNAL_PORT: Record<Exclude<TpEnvironmentKind, 'web'>, number> = {
  terminal: 7681, // ttyd
  vscode: 8080, // code-server
};

const READINESS_TIMEOUT_MS = 60_000;
const READINESS_INTERVAL_MS = 1_000;
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1_000; // reaper : 30 min

export interface StartTpEnvironmentOptions {
  /** URL fournie par le TP (obligatoire et seule pertinente pour kind='web'). */
  url?: string;
  /** Surcharge d'image docker (sinon image par défaut du kind). */
  image?: string;
  /** Répertoire de travail interne pour les commandes exécutées (kind='terminal'). */
  workdir?: string;
  /** Timeout de readiness en ms (défaut 60 s). */
  readinessTimeoutMs?: number;
}

export interface TpEnvironment {
  /** URL HTTP à ouvrir pour capturer le rendu. */
  url: string;
  /** Identifiant du conteneur docker (undefined pour kind='web'). */
  containerId?: string;
  /** Type effectif de l'environnement. */
  kind: TpEnvironmentKind;
  /**
   * Exécute une commande shell DANS le conteneur (kind='terminal' uniquement).
   * Retourne stdout+stderr concaténés. Sans effet pour vscode/web.
   */
  exec(command: string): Promise<string>;
  /** Arrête et supprime le conteneur (idempotent, best-effort). */
  stop(): Promise<void>;
}

/** Erreur levée quand Docker n'est pas disponible sur la machine. */
export class DockerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Docker indisponible — impossible de démarrer un environnement TP');
    this.name = 'DockerUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * Vérifie que le démon Docker répond (`docker info`). Retourne false plutôt
 * que de jeter : l'appelant décide de skipper proprement.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['info'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Crée le réseau dédié s'il n'existe pas déjà (idempotent). */
async function ensureNetwork(): Promise<void> {
  try {
    await execa('docker', ['network', 'inspect', TP_NETWORK], { timeout: 10_000 });
    return; // existe déjà
  } catch {
    // absent → on le crée ci-dessous
  }
  try {
    // Réseau bridge isolé : aucun conteneur applicatif n'y est rattaché.
    await execa('docker', ['network', 'create', '--driver', 'bridge', TP_NETWORK], {
      timeout: 15_000,
    });
    logger.info({ network: TP_NETWORK }, 'réseau TP créé');
  } catch (err) {
    // Course possible entre deux démarrages concurrents : re-inspecter.
    try {
      await execa('docker', ['network', 'inspect', TP_NETWORK], { timeout: 10_000 });
    } catch {
      throw err;
    }
  }
}

/** Lit le port hôte publié pour un port interne donné. */
async function readPublishedPort(containerId: string, internalPort: number): Promise<number> {
  const { stdout } = await execa('docker', ['port', containerId, `${internalPort}/tcp`], {
    timeout: 10_000,
  });
  // Format : "0.0.0.0:49153" (potentiellement plusieurs lignes IPv4/IPv6).
  const line = stdout.split('\n').find((l) => l.includes(':'));
  const port = line ? Number.parseInt(line.trim().split(':').pop() ?? '', 10) : NaN;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`port hôte introuvable pour ${containerId} (${internalPort}) : "${stdout}"`);
  }
  return port;
}

/** Polling HTTP jusqu'à réponse (n'importe quel statut) ou timeout. */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), READINESS_INTERVAL_MS);
      try {
        await fetch(url, { signal: controller.signal });
        return; // toute réponse HTTP prouve que le service écoute
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      lastErr = err;
      await sleep(READINESS_INTERVAL_MS);
    }
  }
  throw new Error(
    `readiness dépassée (${timeoutMs} ms) pour ${url}${
      lastErr instanceof Error ? ` — ${lastErr.message}` : ''
    }`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Supprime un conteneur de force, en silence (best-effort). */
async function forceRemove(containerId: string): Promise<void> {
  try {
    await execa('docker', ['rm', '-f', containerId], { timeout: 20_000 });
  } catch (err) {
    logger.warn({ containerId, err }, 'suppression du conteneur TP impossible');
  }
}

/**
 * Démarre un environnement de démonstration pour un TP.
 *
 * - kind='web'      : ne démarre RIEN, renvoie simplement l'URL fournie ;
 * - kind='terminal' : ttyd (terminal web) ; utilisez env.exec() pour lancer les
 *   commandes du TP, puis capturez env.url ;
 * - kind='vscode'   : code-server accessible sans authentification.
 *
 * Cleanup garanti : en cas d'échec après création, le conteneur est supprimé
 * avant de propager l'erreur. En succès, l'appelant DOIT appeler env.stop().
 *
 * @throws DockerUnavailableError si Docker ne répond pas (kinds terminal/vscode).
 */
export async function startTpEnvironment(
  kind: TpEnvironmentKind,
  opts: StartTpEnvironmentOptions = {},
): Promise<TpEnvironment> {
  if (kind === 'web') {
    if (!opts.url) {
      throw new Error("kind='web' exige une 'url' fournie par le TP");
    }
    return {
      url: opts.url,
      kind: 'web',
      exec: async () => '',
      stop: async () => {},
    };
  }

  if (!(await isDockerAvailable())) {
    throw new DockerUnavailableError();
  }
  await ensureNetwork();

  const image = opts.image ?? DEFAULT_IMAGES[kind];
  const internalPort = INTERNAL_PORT[kind];
  const name = `sc-tp-${kind}-${nanoid(8).toLowerCase()}`;
  const readinessTimeout = opts.readinessTimeoutMs ?? READINESS_TIMEOUT_MS;

  const runArgs = [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '--label',
    `${TP_CONTAINER_LABEL}=1`,
    '--network',
    TP_NETWORK,
    // Publie le port interne sur un port hôte aléatoire (host 0 = éphémère).
    '-p',
    `127.0.0.1::${internalPort}`,
    ...kindRunArgs(kind, image, opts),
  ];

  let containerId: string;
  try {
    const { stdout } = await execa('docker', runArgs, { timeout: 60_000 });
    containerId = stdout.trim();
  } catch (err) {
    throw new DockerUnavailableError(err);
  }

  try {
    const hostPort = await readPublishedPort(containerId, internalPort);
    const url = `http://127.0.0.1:${hostPort}`;
    await waitForHttp(url, readinessTimeout);
    logger.info({ containerId, kind, url }, 'environnement TP prêt');

    return {
      url,
      containerId,
      kind,
      exec: async (command: string) => {
        const workdir = opts.workdir;
        const args = ['exec', ...(workdir ? ['-w', workdir] : []), containerId, 'sh', '-lc', command];
        try {
          const res = await execa('docker', args, { timeout: 120_000, reject: false });
          return [res.stdout, res.stderr].filter(Boolean).join('\n');
        } catch (err) {
          const e = err as ExecaError;
          return typeof e.stderr === 'string' ? e.stderr : String(err);
        }
      },
      stop: async () => forceRemove(containerId),
    };
  } catch (err) {
    // Cleanup garanti si la readiness (ou la lecture de port) échoue.
    await forceRemove(containerId);
    throw err;
  }
}

/** Arguments spécifiques à l'image (commande interne). */
function kindRunArgs(
  kind: Exclude<TpEnvironmentKind, 'web'>,
  image: string,
  opts: StartTpEnvironmentOptions,
): string[] {
  if (kind === 'terminal') {
    // ttyd sert un shell interactif sur son port ; on exécute ensuite les
    // commandes via `docker exec`. -W permet l'écriture (utile en démo).
    return [image, 'ttyd', '-W', '-p', String(INTERNAL_PORT.terminal), 'sh'];
  }
  // code-server sans authentification, écoute sur toutes les interfaces.
  const bind = `0.0.0.0:${INTERNAL_PORT.vscode}`;
  const args = [image, '--auth', 'none', '--bind-addr', bind];
  if (opts.workdir) args.push(opts.workdir);
  return args;
}

/**
 * Reaper : supprime tous les conteneurs TP plus vieux que maxAgeMs (fuites,
 * jobs tués). À appeler périodiquement ou au démarrage du worker. Best-effort :
 * ne jette jamais, retourne le nombre de conteneurs supprimés.
 */
export async function killTpContainersOlderThan(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<number> {
  if (!(await isDockerAvailable())) return 0;

  let ids: string[];
  try {
    const { stdout } = await execa(
      'docker',
      ['ps', '-q', '--filter', `label=${TP_CONTAINER_LABEL}=1`],
      { timeout: 10_000 },
    );
    ids = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    logger.warn({ err }, 'listing des conteneurs TP impossible');
    return 0;
  }

  const now = Date.now();
  let removed = 0;
  for (const id of ids) {
    try {
      const { stdout } = await execa(
        'docker',
        ['inspect', '-f', '{{.State.StartedAt}}', id],
        { timeout: 10_000 },
      );
      const startedAt = Date.parse(stdout.trim());
      if (Number.isFinite(startedAt) && now - startedAt > maxAgeMs) {
        await forceRemove(id);
        removed += 1;
      }
    } catch (err) {
      logger.warn({ containerId: id, err }, 'inspection du conteneur TP impossible');
    }
  }

  if (removed > 0) logger.info({ removed }, 'conteneurs TP fauchés (âge dépassé)');
  return removed;
}
