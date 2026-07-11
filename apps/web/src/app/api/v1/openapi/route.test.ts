import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Test de non-régression (Prompt 127) : le spec OpenAPI exposé par
// GET /api/v1/openapi doit couvrir TOUTES les routes réellement présentes
// sous app/api/v1 (chemin + méthode HTTP), pour éviter toute dérive entre le
// code et la documentation publique au fil des prompts futurs. On scanne le
// système de fichiers (arborescence App Router = source de vérité des routes)
// plutôt que d'appeler Next.js, pour rester rapide et sans dépendance runtime.

import { GET } from './route';

/** Un segment [xxx] du App Router devient {xxx} dans un chemin OpenAPI. */
function toOpenApiPath(routeDir: string): string {
  return routeDir
    .split('/')
    .map((seg) => (seg.startsWith('[') && seg.endsWith(']') ? `{${seg.slice(1, -1)}}` : seg))
    .join('/');
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Scanne récursivement app/api/v1 et retourne { "/chemin": Set<méthode> }. */
function scanV1Routes(v1Dir: string): Map<string, Set<string>> {
  const routes = new Map<string, Set<string>>();

  function walk(dir: string, relSegments: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, [...relSegments, entry.name]);
      } else if (entry.isFile() && /^route\.tsx?$/.test(entry.name)) {
        const routePath = `/${toOpenApiPath(relSegments.join('/'))}`;
        const source = fs.readFileSync(abs, 'utf-8');
        const methods = new Set<string>();
        for (const method of HTTP_METHODS) {
          const re = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`);
          if (re.test(source)) methods.add(method);
        }
        if (methods.size > 0) routes.set(routePath, methods);
      }
    }
  }

  walk(v1Dir, []);
  return routes;
}

describe('spec OpenAPI v1 — couverture exhaustive des routes réelles', () => {
  it('déclare un path + méthode pour chaque route.ts sous app/api/v1 (hors /openapi lui-même)', async () => {
    const v1Dir = path.resolve(__dirname, '..');
    const realRoutes = scanV1Routes(v1Dir);
    // La route openapi elle-même n'a pas vocation à se documenter.
    realRoutes.delete('/openapi');

    const response = GET();
    const spec = (await response.json()) as { paths: Record<string, Record<string, unknown>> };

    const missing: string[] = [];
    for (const [routePath, methods] of realRoutes) {
      const specPath = spec.paths[routePath];
      if (!specPath) {
        missing.push(`${routePath} (path absent du spec)`);
        continue;
      }
      for (const method of methods) {
        if (!specPath[method.toLowerCase()]) {
          missing.push(`${method} ${routePath}`);
        }
      }
    }

    expect(missing, `Routes v1 non documentées dans le spec OpenAPI :\n${missing.join('\n')}`).toEqual([]);
  });

  it('ne déclare aucun path/méthode fantôme (présent dans le spec mais sans route.ts correspondante)', async () => {
    const v1Dir = path.resolve(__dirname, '..');
    const realRoutes = scanV1Routes(v1Dir);

    const response = GET();
    const spec = (await response.json()) as { paths: Record<string, Record<string, unknown>> };

    const ghosts: string[] = [];
    for (const [specPath, methods] of Object.entries(spec.paths)) {
      const real = realRoutes.get(specPath);
      for (const method of Object.keys(methods)) {
        if (!real || !real.has(method.toUpperCase())) {
          ghosts.push(`${method.toUpperCase()} ${specPath}`);
        }
      }
    }

    expect(ghosts, `Entrées du spec OpenAPI sans route.ts correspondante :\n${ghosts.join('\n')}`).toEqual([]);
  });
});
