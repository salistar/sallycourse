import { readFile } from 'node:fs/promises';
import type { ParsedArgs } from './args.js';
import { optBool, optString, splitCsv } from './args.js';
import { resolveConfig } from './config.js';
import { apiRequest } from './client.js';
import {
  buildCreateCourseBody,
  buildDeployBody,
  parseBatchFile,
  type BatchEntry,
} from './requests.js';
import { CREATE_HELP, DEPLOY_HELP, STATUS_HELP } from './help.js';

// Implémentation des commandes. Les E/S (env, console, fetch, fichiers) sont
// injectées via `Io` pour rester testables ; la logique de forme des requêtes
// vit dans requests.ts (pure).

export interface Io {
  env: NodeJS.ProcessEnv;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetchImpl?: typeof fetch;
  /** Lecture de fichier (batch) — injectable pour les tests. */
  readFileImpl?: (path: string) => Promise<string>;
}

/** Réponse serveur d'un create/course. */
interface CourseResponse {
  id: string;
  title: string;
  status: string;
}

/** Réponse serveur d'un status (cours + déploiements). */
interface StatusResponse {
  id: string;
  title: string;
  status: string;
  difficulty?: string;
  locale?: string;
  deployments?: Array<{ platform: string; status: string; externalUrl?: string | null }>;
}

/** Réponse serveur d'un deploy. */
interface DeployResponse {
  courseId: string;
  deployments: Array<{ platform: string; mode: string }>;
}

const defaultIo = (): Required<Pick<Io, 'readFileImpl'>> => ({
  readFileImpl: (path: string) => readFile(path, 'utf8'),
});

/** create : un titre en positionnel, ou --file pour un batch. */
export async function cmdCreate(args: ParsedArgs, io: Io): Promise<number> {
  if (optBool(args, 'help', 'h')) {
    io.log(CREATE_HELP);
    return 0;
  }

  const json = optBool(args, 'json');
  const config = resolveConfig(args, io.env);
  const readFileImpl = io.readFileImpl ?? defaultIo().readFileImpl;

  // Surcharges globales appliquées à chaque entrée.
  const level = optString(args, 'level');
  const lang = optString(args, 'lang');
  const deploy = splitCsv(optString(args, 'deploy'));
  const sectionsRaw = optString(args, 'sections');
  const sections = sectionsRaw !== undefined ? Number.parseInt(sectionsRaw, 10) : undefined;

  // Sélection des entrées : fichier batch OU titre unique positionnel.
  const filePath = optString(args, 'file');
  let entries: BatchEntry[];
  if (filePath) {
    const content = await readFileImpl(filePath);
    entries = parseBatchFile(content);
    if (entries.length === 0) {
      io.error('Aucun titre exploitable dans le fichier batch.');
      return 1;
    }
  } else {
    const title = args.positionals[0];
    if (!title) {
      io.error('Titre manquant. Usage : sallycourse create "<titre>" [options]');
      return 1;
    }
    entries = [{ title }];
  }

  const results: CourseResponse[] = [];
  let failures = 0;

  for (const entry of entries) {
    // Les surcharges par ligne priment sur les flags globaux.
    const body = buildCreateCourseBody({
      title: entry.title,
      level: entry.level ?? level,
      lang: entry.lang ?? lang,
      deploy: entry.deploy ?? (deploy.length > 0 ? deploy : undefined),
      sections: entry.sections ?? (Number.isFinite(sections) ? sections : undefined),
    });

    try {
      const res = await apiRequest<CourseResponse>(config, '/api/v1/courses', {
        method: 'POST',
        body,
        fetchImpl: io.fetchImpl,
      });
      results.push(res);
      if (!json) {
        io.log(`OK  ${res.id}  [${res.status}]  ${res.title}`);
      }
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      io.error(`ECHEC  "${entry.title}" : ${msg}`);
    }
  }

  if (json) {
    io.log(JSON.stringify({ created: results, failures }, null, 2));
  } else {
    io.log(`\n${results.length} cours créé(s), ${failures} échec(s).`);
  }

  return failures > 0 && results.length === 0 ? 1 : 0;
}

/** status : état d'un cours + déploiements. */
export async function cmdStatus(args: ParsedArgs, io: Io): Promise<number> {
  if (optBool(args, 'help', 'h')) {
    io.log(STATUS_HELP);
    return 0;
  }

  const courseId = args.positionals[0];
  if (!courseId) {
    io.error('courseId manquant. Usage : sallycourse status <courseId>');
    return 1;
  }

  const json = optBool(args, 'json');
  const config = resolveConfig(args, io.env);

  try {
    const res = await apiRequest<StatusResponse>(
      config,
      `/api/v1/courses/${encodeURIComponent(courseId)}`,
      { fetchImpl: io.fetchImpl },
    );

    if (json) {
      io.log(JSON.stringify(res, null, 2));
      return 0;
    }

    io.log(`Cours   ${res.id}`);
    io.log(`Titre   ${res.title}`);
    io.log(`Statut  ${res.status}`);
    if (res.difficulty) io.log(`Niveau  ${res.difficulty}`);
    if (res.locale) io.log(`Langue  ${res.locale}`);

    const deployments = res.deployments ?? [];
    if (deployments.length === 0) {
      io.log('Déploiements : aucun.');
    } else {
      io.log('Déploiements :');
      for (const d of deployments) {
        const url = d.externalUrl ? `  ${d.externalUrl}` : '';
        io.log(`  - ${d.platform.padEnd(12)} ${d.status}${url}`);
      }
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.error(`ECHEC status : ${msg}`);
    return 1;
  }
}

/** deploy : lance le déploiement d'un cours sur des plateformes. */
export async function cmdDeploy(args: ParsedArgs, io: Io): Promise<number> {
  if (optBool(args, 'help', 'h')) {
    io.log(DEPLOY_HELP);
    return 0;
  }

  const courseId = args.positionals[0];
  if (!courseId) {
    io.error('courseId manquant. Usage : sallycourse deploy <courseId> --platforms <a,b>');
    return 1;
  }

  const platforms = splitCsv(optString(args, 'platforms', 'deploy'));
  const mode = optString(args, 'mode');
  const json = optBool(args, 'json');

  let body;
  try {
    body = buildDeployBody(platforms, mode);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const config = resolveConfig(args, io.env);

  try {
    const res = await apiRequest<DeployResponse>(
      config,
      `/api/v1/courses/${encodeURIComponent(courseId)}/deploy`,
      { method: 'POST', body, fetchImpl: io.fetchImpl },
    );

    if (json) {
      io.log(JSON.stringify(res, null, 2));
      return 0;
    }

    io.log(`Déploiement lancé pour ${res.courseId} :`);
    for (const d of res.deployments) {
      io.log(`  - ${d.platform.padEnd(12)} mode=${d.mode}`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.error(`ECHEC deploy : ${msg}`);
    return 1;
  }
}
