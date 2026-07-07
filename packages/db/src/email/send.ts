import { createConnection } from 'node:net';
// Import du sous-module direct (et non du baril) : évite que le worker (NodeNext,
// rootDir=src) ne perde le typage de getConfig ré-exporté via @ts-ignore.
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { getConfig } from '@sallycourse/shared/config.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact ; import sur une ligne (le pragma ne couvre que la ligne suivante)
import { renderEmailTemplate, type EmailTemplateData, type EmailTemplateName, type RenderedEmail } from './templates.js';

// Envoi d'email (Prompt 59) — sans SDK. Trois modes, choisis à l'exécution :
//   1. RESEND_API_KEY présent  → API REST Resend (fetch).
//   2. sinon SMTP_URL présent  → SMTP brut (Mailpit en dev, node:net).
//   3. sinon (MOCK)            → journalisé, aucun envoi réseau.
// Toujours best-effort : un échec d'envoi n'interrompt jamais l'appelant.

/** Expéditeur par défaut (surchargable par EMAIL_FROM plus tard). */
const DEFAULT_FROM = 'SallyCourse <notifications@sallycourse.app>';

/** Canal effectivement utilisé — utile aux tests et aux logs. */
export type EmailChannel = 'resend' | 'smtp' | 'mock';

export interface SendEmailResult {
  channel: EmailChannel;
  /** true si l'email a été remis (ou journalisé en mock). */
  ok: boolean;
  /** Détail d'erreur éventuel (mode dégradé). */
  error?: string;
}

/** Détermine le canal d'envoi selon la configuration présente. */
export function resolveEmailChannel(
  env: { RESEND_API_KEY?: string; SMTP_URL?: string } = getConfig(),
): EmailChannel {
  if (env.RESEND_API_KEY) return 'resend';
  if (env.SMTP_URL) return 'smtp';
  return 'mock';
}

/**
 * Envoie un email rendu depuis un gabarit. `to` = destinataire ; `template` =
 * nom du gabarit ; `data` = variables d'interpolation. Ne jette pas.
 */
export async function sendEmail(
  to: string,
  template: EmailTemplateName,
  data: EmailTemplateData = {},
): Promise<SendEmailResult> {
  let config;
  try {
    config = getConfig();
  } catch {
    // Config indisponible (ex. tests sans .env) : dégrade en mock silencieux.
    config = {} as ReturnType<typeof getConfig>;
  }

  const rendered = renderEmailTemplate(template, data);
  const channel = resolveEmailChannel(config);

  try {
    if (channel === 'resend') {
      return await sendViaResend(config.RESEND_API_KEY!, to, rendered);
    }
    if (channel === 'smtp') {
      return await sendViaSmtp(config.SMTP_URL!, to, rendered);
    }
    // Mode mock : on journalise, aucun envoi.
    // eslint-disable-next-line no-console
    console.info(
      `[email:mock] → ${to} · ${template} · sujet="${rendered.subject}"`,
    );
    return { channel: 'mock', ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[email:${channel}] échec d'envoi vers ${to} : ${error}`);
    return { channel, ok: false, error };
  }
}

/* ------------------------------------------------------------------ */
/* Resend — API REST (fetch)                                           */
/* ------------------------------------------------------------------ */

async function sendViaResend(
  apiKey: string,
  to: string,
  rendered: RenderedEmail,
): Promise<SendEmailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status} ${detail}`.trim());
  }
  return { channel: 'resend', ok: true };
}

/* ------------------------------------------------------------------ */
/* SMTP brut (Mailpit dev) — node:net, sans dépendance                 */
/* ------------------------------------------------------------------ */

/** Adresse d'un email (l'entête From complet garde le nom d'affichage). */
const FROM_ADDRESS = 'notifications@sallycourse.app';

/** Construit le message RFC 5322 (MIME multipart texte + html). */
function buildMimeMessage(to: string, rendered: RenderedEmail): string {
  const boundary = `sc_${Date.now().toString(36)}`;
  const headers = [
    `From: ${DEFAULT_FROM}`,
    `To: ${to}`,
    `Subject: ${rendered.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    '',
    rendered.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    '',
    rendered.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headers}\r\n\r\n${body}`;
}

/**
 * Envoi SMTP minimal (HELO/MAIL/RCPT/DATA) sur un serveur sans auth ni TLS —
 * cible Mailpit/MailHog en développement. Parse `smtp://host:port`.
 */
function sendViaSmtp(
  smtpUrl: string,
  to: string,
  rendered: RenderedEmail,
): Promise<SendEmailResult> {
  const url = new URL(smtpUrl);
  const host = url.hostname || 'localhost';
  const port = Number(url.port || 1025);
  const message = buildMimeMessage(to, rendered);

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setEncoding('utf8');
    socket.setTimeout(10_000);

    // File d'attente des commandes ; chaque réponse déclenche la suivante.
    const steps = [
      `EHLO sallycourse\r\n`,
      `MAIL FROM:<${FROM_ADDRESS}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      `DATA\r\n`,
      `${message}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    let step = -1; // -1 : on attend la bannière 220 avant d'envoyer EHLO.

    const fail = (msg: string) => {
      socket.destroy();
      reject(new Error(msg));
    };

    socket.on('data', (chunk: string) => {
      const code = Number(chunk.slice(0, 3));
      // 2xx/3xx = OK ; sinon on abandonne (4xx/5xx).
      if (code >= 400) return fail(`SMTP ${chunk.trim()}`);
      step += 1;
      const next = steps[step];
      if (next !== undefined) {
        socket.write(next);
      } else {
        socket.end();
        resolve({ channel: 'smtp', ok: true });
      }
    });

    socket.on('timeout', () => fail('SMTP timeout'));
    socket.on('error', (err) => fail(err.message));
  });
}
