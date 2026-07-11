import { NextResponse } from 'next/server';

/**
 * GET /api/v1/openapi — spécification OpenAPI 3.1 de l'API publique v1.
 *
 * zod-to-openapi n'est pas disponible dans ce dépôt → le spec est maintenu à la
 * main mais reste aligné sur les schémas Zod de lib/v1-schemas.ts (contrat
 * public stable). Consommable par Swagger UI, Postman ou un générateur de SDK.
 */

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'SallyCourse API publique',
    version: '1.0.0',
    description:
      "API de génération et déploiement de cours. Authentification par clé API : en-tête `Authorization: Bearer <clé>` ou `X-API-Key: <clé>`. Générez une clé depuis Réglages → API.",
  },
  servers: [{ url: '/api/v1' }],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      BearerAuth: { type: 'http', scheme: 'bearer' },
    },
    schemas: {
      CreateCourseRequest: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 120 },
          difficulty: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            default: 'beginner',
          },
          locale: { type: 'string', default: 'fr' },
          platforms: { type: 'array', items: { type: 'string' }, maxItems: 9 },
        },
      },
      Course: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string' },
          difficulty: { type: 'string' },
          locale: { type: 'string' },
          platforms: { type: 'array', items: { type: 'string' } },
        },
      },
      DeployRequest: {
        type: 'object',
        required: ['platforms'],
        properties: {
          platforms: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 9,
          },
          mode: {
            type: 'string',
            enum: ['auto', 'assisted', 'manual'],
            default: 'auto',
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
        },
      },
      ZapierSubscribeRequest: {
        type: 'object',
        required: ['event', 'targetUrl'],
        properties: {
          event: {
            type: 'string',
            enum: ['outline_ready', 'generation_complete', 'deployed', 'review_approved'],
          },
          targetUrl: { type: 'string', format: 'uri' },
        },
      },
      ZapierSubscribeResponse: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          event: { type: 'string' },
          targetUrl: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/courses': {
      get: {
        summary: 'Lister les cours',
        operationId: 'listCourses',
        responses: {
          '200': {
            description: 'Liste des cours',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    courses: { type: 'array', items: { $ref: '#/components/schemas/Course' } },
                  },
                },
              },
            },
          },
          '401': { description: 'Clé API manquante ou invalide' },
        },
      },
      post: {
        summary: 'Créer un cours et lancer sa génération',
        operationId: 'createCourse',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateCourseRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Cours créé',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Course' } },
            },
          },
          '400': { description: 'Données invalides' },
          '401': { description: 'Clé API manquante ou invalide' },
          '402': { description: 'Quota mensuel atteint' },
        },
      },
    },
    '/courses/{id}': {
      get: {
        summary: 'Statut d’un cours',
        operationId: 'getCourse',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Statut du cours',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Course' } },
            },
          },
          '404': { description: 'Cours introuvable' },
        },
      },
    },
    '/courses/{id}/deploy': {
      post: {
        summary: 'Déployer un cours sur des plateformes',
        operationId: 'deployCourse',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DeployRequest' } },
          },
        },
        responses: {
          '202': { description: 'Déploiements enfilés' },
          '400': { description: 'Données invalides ou plateforme inconnue' },
          '409': { description: 'Cours non prêt' },
        },
      },
    },
    '/zapier/hooks': {
      get: {
        summary: 'Lister les abonnements Zapier (webhooks)',
        operationId: 'listZapierHooks',
        responses: { '200': { description: 'Abonnements du porteur de la clé' } },
      },
      post: {
        summary: 'Subscribe REST Hook Zapier — crée un abonnement webhook',
        operationId: 'zapierSubscribe',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ZapierSubscribeRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Abonnement créé',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ZapierSubscribeResponse' },
              },
            },
          },
          '400': { description: 'Données invalides' },
          '401': { description: 'Clé API manquante ou invalide' },
        },
      },
    },
    '/zapier/hooks/{id}': {
      delete: {
        summary: 'Unsubscribe REST Hook Zapier — supprime un abonnement',
        operationId: 'zapierUnsubscribe',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Abonnement supprimé' },
          '404': { description: 'Abonnement introuvable' },
        },
      },
    },
    '/zapier/triggers/{event}/sample': {
      get: {
        summary: 'Exemple de payload pour un déclencheur Zapier',
        operationId: 'zapierTriggerSample',
        parameters: [
          {
            name: 'event',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              enum: ['outline_ready', 'generation_complete', 'deployed', 'review_approved'],
            },
          },
        ],
        responses: {
          '200': { description: 'Tableau contenant un exemple de payload' },
          '404': { description: 'Événement inconnu' },
        },
      },
    },
  },
} as const;

export function GET() {
  return NextResponse.json(spec);
}
