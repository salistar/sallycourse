// Test de charge P100 — 50 générations de cours simultanées, mesure du P95.
//
// Cible : POST /api/v1/courses (API publique authentifiée par clé API,
// apps/web/src/app/api/v1/courses/route.ts). On utilise volontairement
// l'API v1 plutôt que la route interne /api/courses car cette dernière est
// protégée par une session NextAuth (cookie), impossible à obtenir simplement
// depuis k6 ; l'API v1 partage exactement la même logique de création
// (createCourseForUser, cf. apps/web/src/lib/create-course.ts) donc le
// résultat mesuré est représentatif du chemin réel.
//
// ──────────────────────────────────────────────────────────────────────────
// INSTALLATION DE k6 (binaire externe, PAS un paquet npm — n'ajoute rien au
// monorepo pnpm, ne PAS tenter `pnpm add k6`) :
//   - Windows (winget)  : winget install k6 --source winget
//   - Windows (choco)   : choco install k6
//   - macOS (brew)      : brew install k6
//   - Linux (apt)       : voir https://k6.io/docs/get-started/installation/
//   - Docker (sans install locale) :
//       docker run --rm -i --network host -e MOCK_PROVIDERS=true \
//         -e SALLYCOURSE_BASE_URL=http://localhost:3000 \
//         -e SALLYCOURSE_API_KEY=sk_xxx \
//         grafana/k6 run - < scripts/load-test.k6.js
// ──────────────────────────────────────────────────────────────────────────
//
// PRÉREQUIS — FORCER LE MODE MOCK (sinon ce test déclenche 50 vraies
// générations facturées : Claude, ElevenLabs/OpenAI TTS, etc.) :
//   1. Web  : MOCK_PROVIDERS=true dans apps/web/.env (ou l'env du conteneur web)
//   2. Worker : MOCK_PROVIDERS=true dans apps/worker/.env (ou l'env du conteneur worker)
//   Les DEUX côtés comptent : le web valide/enqueue la requête, le worker
//   traite réellement le job de génération (outline, contenu, TTS, etc.).
//   Redémarrer web ET worker après avoir positionné la variable
//   (`pnpm up` relit l'env au démarrage des conteneurs ; en dev sur l'hôte,
//   relancer `pnpm --filter @sallycourse/web dev` / `...worker dev`).
//
// PRÉREQUIS — OBTENIR UNE CLÉ API DE TEST :
//   Se connecter sur l'app (compte de test, plan business recommandé pour
//   éviter le mur de quota mensuel — cf. PLANS.business.coursesPerMonth =
//   Infinity dans packages/shared/src/constants.ts), puis :
//     /dashboard/settings/api-keys → "API & Webhooks" → créer une clé.
//   La clé en clair n'est affichée qu'UNE SEULE FOIS à la création : la
//   copier immédiatement dans la variable d'env ci-dessous.
//   Note : un plan free/pro fonctionne aussi pour ce test (le champ `api`
//   du plan n'est actuellement pas vérifié par /api/v1), mais son quota
//   mensuel de cours (1 ou 10) sera vite atteint — les requêtes au-delà
//   renverront 402 `quota_exceeded`, ce qui reste une réponse HTTP mesurée
//   (donc n'invalide pas le P95) mais ne représente plus une "génération"
//   réelle. Pour un test propre, préférer un compte business ou nettoyer/
//   recréer le compte de test entre deux runs.
//
// VARIABLES D'ENVIRONNEMENT :
//   SALLYCOURSE_BASE_URL   URL de base de l'app web (défaut http://localhost:3000)
//   SALLYCOURSE_API_KEY    clé API en clair (obligatoire, cf. ci-dessus)
//   SALLYCOURSE_VUS        nombre de générations simultanées (défaut 50)
//
// LANCEMENT :
//   MOCK_PROVIDERS=true \
//   SALLYCOURSE_BASE_URL=http://localhost:3000 \
//   SALLYCOURSE_API_KEY=sk_xxx \
//   k6 run scripts/load-test.k6.js
//
// La variable MOCK_PROVIDERS ci-dessus, dans le shell qui lance k6, ne sert
// qu'à rappeler visuellement la précondition : k6 ne la transmet PAS au
// serveur (les process web/worker doivent l'avoir dans LEUR PROPRE env,
// cf. section précédente). k6 ne fait qu'appeler l'API HTTP.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.SALLYCOURSE_BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.SALLYCOURSE_API_KEY;
const VUS = Number(__ENV.SALLYCOURSE_VUS || 50);

if (!API_KEY) {
  throw new Error(
    'SALLYCOURSE_API_KEY manquante — générez une clé sur /dashboard/settings/api-keys ' +
      'et passez-la en variable d\'environnement avant de lancer k6.',
  );
}

// Trend dédié pour isoler le P95 de la création de cours des autres métriques
// k6 (http_req_duration inclurait aussi d'éventuelles requêtes annexes).
const createCourseDuration = new Trend('create_course_duration', true);

export const options = {
  scenarios: {
    // 50 générations "simultanées" : chaque VU (utilisateur virtuel) envoie
    // une seule requête de création de cours puis s'arrête (pas de boucle
    // continue — on simule un pic de lancement, pas un trafic soutenu).
    burst_course_creation: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    // Budget indicatif : POST /api/v1/courses ne fait qu'enqueue (valider,
    // vérifier quota, créer le doc Mongo, empiler un job BullMQ) — la
    // génération réelle est asynchrone côté worker (cf. §3 LAUNCH-CHECKLIST).
    // Un P95 très supérieur à cette fenêtre indique un problème (index Mongo
    // manquant, latence Redis, connexion DB non poolée), pas la charge IA.
    create_course_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

// Titres variés pour éviter tout comportement de cache trivial côté modération
// ou déduplication accidentelle ; suffixés par VU + itération pour l'unicité.
const TITLE_SEEDS = [
  'Maîtriser Docker en 7 jours',
  'Kubernetes pour les débutants',
  'Introduction à la cybersécurité',
  'Automatiser son marketing avec Zapier',
  'Les fondamentaux de la finance personnelle',
  'Apprendre Python pour la data',
  'Gérer un projet Agile de A à Z',
  'Créer sa boutique Shopify',
];

export default function () {
  const title = `${TITLE_SEEDS[__VU % TITLE_SEEDS.length]} — charge ${__VU}-${__ITER}`;

  const payload = JSON.stringify({
    title,
    difficulty: 'beginner',
    locale: 'fr',
    platforms: [],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    tags: { name: 'POST /api/v1/courses' },
  };

  const res = http.post(`${BASE_URL}/api/v1/courses`, payload, params);
  createCourseDuration.add(res.timings.duration);

  // 201 = créé, 402 = quota mensuel atteint (réponse valide de l'API, pas une
  // panne), 429 = rate limited. On ne valide QUE le statut, pas le contenu du
  // job (la génération se termine de façon asynchrone côté worker).
  check(res, {
    'statut HTTP attendu (201/402/429)': (r) =>
      [201, 402, 429].includes(r.status),
    'pas d\'erreur serveur (5xx)': (r) => r.status < 500,
  });

  sleep(1);
}

// À la fin du run, k6 affiche le résumé standard (dont http_req_duration
// p(95)) ainsi que le Trend dédié create_course_duration. Pour un rapport
// JSON exploitable en CI : `k6 run --out json=load-test-results.json ...`.
