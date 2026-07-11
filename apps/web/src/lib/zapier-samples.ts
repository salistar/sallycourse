import type { WebhookEvent } from '@sallycourse/db';
import { buildWebhookBody } from '@/lib/deploy/webhooks';

/**
 * Exemples de payloads par événement (Prompt 97 — intégration Zapier). Utilisés
 * par GET /api/v1/zapier/triggers/[event]/sample pour que l'éditeur de Zap de
 * Zapier puisse déduire les champs disponibles sans attendre un événement réel
 * (exigence du REST Hook standard : un déclencheur doit fournir un exemple).
 *
 * Les données restent volontairement représentatives mais fictives — aucune
 * lecture base ne doit être nécessaire pour construire un exemple.
 */

const SAMPLE_DATA: Record<WebhookEvent, Record<string, unknown>> = {
  outline_ready: {
    courseId: '507f1f77bcf86cd799439011',
    title: 'Introduction à la data science avec Python',
    status: 'outline_ready',
    sectionsCount: 8,
    lessonsCount: 34,
  },
  generation_complete: {
    courseId: '507f1f77bcf86cd799439011',
    title: 'Introduction à la data science avec Python',
    status: 'ready',
    lessonsCount: 34,
    quizCount: 8,
    durationMinutes: 245,
  },
  deployed: {
    courseId: '507f1f77bcf86cd799439011',
    title: 'Introduction à la data science avec Python',
    platform: 'udemy',
    mode: 'auto',
    externalUrl: 'https://www.udemy.com/course/exemple-cours/',
  },
  review_approved: {
    courseId: '507f1f77bcf86cd799439011',
    title: 'Introduction à la data science avec Python',
    reviewerId: '507f1f77bcf86cd799439099',
    approvedAt: '2026-07-01T10:00:00.000Z',
  },
};

/** Construit l'exemple de payload complet (event + timestamp + data) pour un événement donné. */
export function buildSamplePayload(event: WebhookEvent) {
  const { payload } = buildWebhookBody(event, SAMPLE_DATA[event]);
  return payload;
}
