// Les @ts-ignore TS6059 neutralisent le diagnostic de programme quand ce service
// est consommé en source par le worker (tsconfig NodeNext, rootDir=src) ; sans
// effet sur le typage ni l'exécution (voir apps/worker/src/shared.ts).
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { connectDb } from './connect.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { Notification, type NotificationType, type NotificationDocument } from './models/notification.js';
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { User } from './models/user.js';
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import { sendEmail } from './email/send.js';
// @ts-ignore TS6059 — source hors rootDir (worker), typage intact
import type { EmailTemplateData, EmailTemplateName } from './email/templates.js';

// Service de notification partagé (Prompt 59). Point d'entrée unique appelé aux
// transitions du cycle de vie, depuis le web (Route Handlers) comme depuis le
// worker (processors). Persiste une Notification in-app puis, selon le type,
// envoie un email best-effort. Ne jette jamais : la notification ne doit pas
// faire échouer le flux métier appelant.

/** Correspondance type de notif → gabarit email (undefined = pas d'email). */
const EMAIL_TEMPLATE_BY_TYPE: Record<NotificationType, EmailTemplateName | undefined> = {
  generation_complete: 'generation_complete',
  deployment_complete: 'deployment_complete',
  review_approved: 'review_approved',
  review_rejected: 'review_rejected',
  quota_reached: 'quota_reached',
  // Pas d'email : simple log de traçabilité interne (voir voice-clone.ts).
  voice_clone_used: undefined,
  // Pas d'email : suggestion consultable dans le dashboard (voir course-refresh.ts).
  course_refresh_available: undefined,
  // Pas d'email : rapport de révision consultable sur la page cours (2026-07-26).
  course_review_done: undefined,
  // Gamification (P200) — décision produit : ces trois types restent in-app
  // (+ Web Push pour le rappel de streak). AUCUN nouveau gabarit email.
  streak_reminder: undefined,
  badge_earned: undefined,
  level_up: undefined,
  // Pas d'email : alerte/signalement consultable in-app (P206, anti-partage).
  account_sharing_suspected: undefined,
};

export interface NotifyInput {
  /** Nature de l'événement. */
  type: NotificationType;
  /** Titre court (in-app). */
  title: string;
  /** Corps descriptif (in-app). */
  body: string;
  /** Lien interne facultatif ouvert au clic. */
  link?: string;
  /** Envoyer aussi l'email associé (défaut : true si un gabarit existe). */
  email?: boolean;
  /** Variables passées au gabarit email (courseTitle, platform, actionUrl…). */
  emailData?: EmailTemplateData;
}

export interface NotifyResult {
  notification: NotificationDocument;
  emailed: boolean;
}

/**
 * Émet une notification pour un utilisateur : enregistre l'entrée in-app et,
 * si applicable, déclenche l'email. `userId` = ObjectId (string accepté).
 * Best-effort sur l'email ; l'enregistrement in-app reste la source de vérité.
 */
export async function notify(
  userId: string,
  input: NotifyInput,
): Promise<NotifyResult> {
  await connectDb();

  const notification = await Notification.create({
    userId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
  });

  let emailed = false;
  const template = EMAIL_TEMPLATE_BY_TYPE[input.type];
  const wantEmail = input.email ?? Boolean(template);

  if (wantEmail && template) {
    try {
      const user = await User.findById(userId).select('email name plan').lean();
      if (user?.email) {
        const data: EmailTemplateData = { name: user.name, ...input.emailData };
        // `user.plan` pilote resolveEmailChannel en PROVIDER_MODE=auto (P156).
        const result = await sendEmail(user.email, template, data, user.plan);
        emailed = result.ok;
      }
    } catch {
      // L'email est best-effort ; l'échec ne remonte pas.
      emailed = false;
    }
  }

  return { notification, emailed };
}
