// Prompt 151 — EmailProvider cloud : Resend (API REST simple, clé unique).
// MOCK_PROVIDERS ou RESEND_API_KEY absente → mode mock (log, aucun envoi réel)
// — jamais d'échec bloquant du pipeline (séquences email post-inscription,
// lib/email-sequence.ts, ne doivent jamais faire échouer un job pour un envoi
// raté).
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
import type { EmailProvider } from './types.js';

const RESEND_BASE_URL = 'https://api.resend.com';
/** Expéditeur par défaut — surchargeable si un domaine vérifié Resend change. */
const DEFAULT_FROM = 'SallyCourse <no-reply@sallycourse.com>';

export const resendEmailProvider: EmailProvider = {
  name: 'resend',
  async send(to: string, subject: string, html: string): Promise<void> {
    const cfg = getConfig();
    if (cfg.MOCK_PROVIDERS || !cfg.RESEND_API_KEY) {
      logger.debug({ to, subject, mock: true }, 'email-resend : mode mock — aucun envoi réel');
      return;
    }

    const res = await fetch(`${RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: DEFAULT_FROM, to, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend ${res.status} : ${detail.slice(0, 200)}`);
    }
    logger.info({ to, subject }, 'email-resend : envoyé');
  },
};
