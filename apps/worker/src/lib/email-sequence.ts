// Email marketing — séquences programmées (Prompt 140). Étend le service
// d'email existant (P59, packages/db/src/email/) sans le modifier :
//
//  1) generateEmailSequence : callClaudeJson produit les étapes (delayDays/
//     subject/bodyTemplate) d'un scénario (launch/nurturing/winback), mock-
//     friendly (fixture déterministe hors-ligne, comme course-refresh.ts).
//  2) detectInactiveEnrollments : LMS interne (P43) — Enrollment sans activité
//     récente (updatedAt ancien) = candidat à une séquence "winback".
//  3) computeNextSendAt / advanceEnrollment : calcul PUR de l'échéance
//     suivante à partir de delayDays (pas d'I/O — testable directement).
//  4) Intégration CRM externe (best-effort) : si l'utilisateur a connecté un
//     CRM (PlatformCredential platform='crm'), la liste de contacts vient de
//     là ; SINON on retombe sur la base des étudiants inscrits (Enrollment)
//     — jamais d'échec bloquant, toujours un mode dégradé fonctionnel.
//  5) Scheduler BullMQ repeatable (même pattern que lib/retention.ts) : envoie
//     les emails dus (nextSendAt <= now) via le service existant, avance
//     l'échéance ou clôture l'inscription en fin de séquence.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { z } from 'zod';
import {
  Course,
  Enrollment,
  EmailSequence,
  EmailSequenceEnrollment,
  PlatformCredential,
  User,
  getConfig,
  sendEmail,
  type EmailSequenceKind,
  type IEmailSequenceStep,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from './claude.js';
import { emailSequenceSystemPrompt, emailSequenceUserPrompt, type EmailSequencePromptInput } from '../prompts/email-sequence.js';

/* ------------------------------------------------------------------ */
/* 1) Génération de séquence (Claude, mock-friendly)                   */
/* ------------------------------------------------------------------ */

const emailSequenceStepGenSchema = z.object({
  delayDays: z.number().int().min(0),
  subject: z.string().min(1),
  bodyTemplate: z.string().min(1),
});

export const emailSequenceGenerationSchema = z.object({
  steps: z.array(emailSequenceStepGenSchema).min(1),
});
export type EmailSequenceGeneration = z.infer<typeof emailSequenceGenerationSchema>;

/** Nombre d'étapes par défaut d'une fixture mock, selon le type de scénario. */
const MOCK_STEP_COUNT: Record<EmailSequenceKind, number> = {
  launch: 2,
  nurturing: 5,
  winback: 2,
};

/**
 * Fixture déterministe hors-ligne (MOCK_PROVIDERS=true ou appel LLM en échec) :
 * un jeu d'étapes réaliste et STABLE pour un même (kind, courseTitle), sans
 * appel réseau. Ne remplace jamais un vrai raisonnement du modèle en prod.
 */
export function mockEmailSequenceGeneration(
  courseTitle: string,
  kind: EmailSequenceKind,
): EmailSequenceGeneration {
  const count = MOCK_STEP_COUNT[kind];
  const delays = kind === 'nurturing' ? [0, 3, 7, 14, 21] : kind === 'launch' ? [0, 2] : [0, 4];
  const steps: IEmailSequenceStep[] = Array.from({ length: count }, (_, i) => {
    const delayDays = delays[i] ?? (i + 1) * 5;
    if (kind === 'launch') {
      return {
        delayDays,
        subject: i === 0 ? `« ${courseTitle} » est disponible dès maintenant` : `Dernière chance de découvrir « ${courseTitle} »`,
        bodyTemplate: `Bonjour {{name}},<br/><br/>${i === 0 ? 'Le cours' : 'Rappel : le cours'} « {{courseTitle}} » vient d'être mis en ligne. Inscrivez-vous dès aujourd'hui pour commencer à progresser.`,
      };
    }
    if (kind === 'winback') {
      return {
        delayDays,
        subject: i === 0 ? `On continue « ${courseTitle} » ?` : `{{name}}, votre place vous attend toujours`,
        bodyTemplate: `Bonjour {{name}},<br/><br/>Nous avons remarqué que vous n'avez pas repris « {{courseTitle}} » récemment. Reprenez où vous vous étiez arrêté(e), à votre rythme.`,
      };
    }
    const nurturingSubjects = [
      `Bienvenue dans « ${courseTitle} »`,
      `Une leçon à ne pas manquer dans « ${courseTitle} »`,
      `Comment bien progresser dans « ${courseTitle} »`,
      `Ce que d'autres apprenants ont retenu de « ${courseTitle} »`,
      `Vous y êtes presque : terminez « ${courseTitle} »`,
    ];
    return {
      delayDays,
      subject: nurturingSubjects[i] ?? `« ${courseTitle} » — étape ${i + 1}`,
      bodyTemplate: `Bonjour {{name}},<br/><br/>${nurturingSubjects[i] ?? `Poursuivons « {{courseTitle}} »`}. Prenez quelques minutes aujourd'hui pour continuer votre progression.`,
    };
  });
  return emailSequenceGenerationSchema.parse({ steps });
}

/**
 * Génère les étapes d'une séquence email pour un cours donné. En mock, la
 * fixture déterministe est retournée directement. En réel, appelle Claude et
 * retombe sur la fixture en cas d'échec (ne jette jamais).
 */
export async function generateEmailSequence(
  input: EmailSequencePromptInput,
): Promise<EmailSequenceGeneration> {
  const mock = getConfig().MOCK_PROVIDERS;
  if (mock) return mockEmailSequenceGeneration(input.courseTitle, input.kind);
  try {
    return await callClaudeJson<EmailSequenceGeneration>({
      schema: emailSequenceGenerationSchema,
      system: emailSequenceSystemPrompt(),
      user: emailSequenceUserPrompt(input),
    });
  } catch (err) {
    logger.warn({ err, kind: input.kind }, 'email-sequence : génération LLM échouée — fallback fixture');
    return mockEmailSequenceGeneration(input.courseTitle, input.kind);
  }
}

/* ------------------------------------------------------------------ */
/* 2) Détection des étudiants inactifs (LMS interne, P43)              */
/* ------------------------------------------------------------------ */

/** Seuil par défaut d'inactivité avant relance winback (30 jours). */
export const WINBACK_INACTIVITY_DAYS = 30;

/** Forme minimale d'un Enrollment pour la détection (pure, testable sans Mongo). */
export interface EnrollmentActivityInfo {
  id: string;
  studentId: string;
  courseTitle: string;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Filtre les enrollments SANS activité récente (updatedAt trop ancien) et pas
 * déjà complétés (un cours terminé n'a pas besoin d'une relance winback).
 * Fonction pure — l'appelant fournit `now` et la liste (déjà chargée).
 */
export function selectInactiveEnrollments(
  enrollments: readonly EnrollmentActivityInfo[],
  now: Date,
  thresholdDays: number = WINBACK_INACTIVITY_DAYS,
): EnrollmentActivityInfo[] {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return enrollments.filter(
    (e) => !e.completedAt && now.getTime() - e.updatedAt.getTime() >= thresholdMs,
  );
}

/* ------------------------------------------------------------------ */
/* 3) Calcul pur de l'échéance suivante                                */
/* ------------------------------------------------------------------ */

/**
 * Date d'inscription + delayDays de l'étape ciblée = prochaine échéance
 * d'envoi. Fonction pure (aucune I/O) — `enrolledAt` reste la référence fixe
 * pour TOUTES les étapes (pas de dérive cumulative si un envoi est en retard).
 */
export function computeNextSendAt(enrolledAt: Date, delayDays: number): Date {
  return new Date(enrolledAt.getTime() + delayDays * 24 * 60 * 60 * 1000);
}

/** Résultat de l'avancement d'une inscription après envoi d'une étape. */
export interface AdvanceResult {
  nextStepIndex: number;
  nextSendAt: Date;
  status: 'active' | 'completed';
}

/**
 * Calcule l'état suivant d'une EmailSequenceEnrollment après l'envoi de
 * l'étape `sentStepIndex` : index suivant, échéance suivante (dérivée de
 * `enrolledAt`, PAS de `now` — évite toute dérive), ou clôture ('completed')
 * si `sentStepIndex` était la dernière étape. Fonction pure.
 */
export function advanceEnrollment(
  steps: readonly IEmailSequenceStep[],
  sentStepIndex: number,
  enrolledAt: Date,
): AdvanceResult {
  const nextStepIndex = sentStepIndex + 1;
  const nextStep = steps[nextStepIndex];
  if (!nextStep) {
    return { nextStepIndex, nextSendAt: enrolledAt, status: 'completed' };
  }
  return {
    nextStepIndex,
    nextSendAt: computeNextSendAt(enrolledAt, nextStep.delayDays),
    status: 'active',
  };
}

/* ------------------------------------------------------------------ */
/* Interpolation des variables du gabarit ({{name}}/{{courseTitle}})   */
/* ------------------------------------------------------------------ */

/** Remplace {{name}} et {{courseTitle}} dans un corps de gabarit (best-effort). */
export function interpolateTemplate(template: string, vars: { name?: string; courseTitle?: string }): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/g, vars.name?.trim() || 'là')
    .replace(/\{\{\s*courseTitle\s*\}\}/g, vars.courseTitle?.trim() || 'votre cours');
}

/* ------------------------------------------------------------------ */
/* 4) Roster de contacts — CRM externe si connecté, sinon Enrollment    */
/* ------------------------------------------------------------------ */

export interface SequenceContact {
  email: string;
  name?: string;
  studentId?: string;
}

/**
 * Détermine si l'utilisateur a un CRM externe connecté (PlatformCredential
 * platform='crm', best-effort — aucun CRM concret n'est câblé aujourd'hui,
 * seule la détection de connexion est faite ; en son absence on retombe
 * TOUJOURS sur la base des étudiants inscrits (Enrollment), jamais d'échec).
 */
export async function hasCrmConnected(userId: string): Promise<boolean> {
  const cred = await PlatformCredential.exists({ userId, platform: 'crm' });
  return Boolean(cred);
}

/**
 * Construit la liste de contacts à inscrire pour un cours : si un CRM externe
 * est connecté, ce roster sera enrichi/remplacé par l'appelant (P140 ne câble
 * aucun connecteur CRM concret — mode dégradé documenté) ; sinon (cas par
 * défaut) la base des étudiants inscrits au cours (Enrollment) sert de roster.
 */
export async function resolveSequenceContacts(courseId: string): Promise<SequenceContact[]> {
  const enrollments = await Enrollment.find({ courseId }).select('studentId').lean();
  const studentIds = enrollments.map((e) => String(e.studentId));
  if (!studentIds.length) return [];

  const students = await User.find({ _id: { $in: studentIds } }).select('_id email name').lean();
  return students.map((s) => ({ email: s.email, name: s.name, studentId: String(s._id) }));
}

/* ------------------------------------------------------------------ */
/* Inscription d'un contact à une séquence (idempotent)                */
/* ------------------------------------------------------------------ */

/**
 * Inscrit un contact à une séquence : upsert (sequenceId, email) — une
 * ré-inscription est un no-op (index unique). `enrolledAt` par défaut = now.
 */
export async function enrollContactInSequence(
  sequenceId: string,
  sequence: { steps: IEmailSequenceStep[] },
  contact: SequenceContact,
  courseTitle: string,
  enrolledAt: Date = new Date(),
): Promise<void> {
  const firstStep = sequence.steps[0];
  if (!firstStep) return;

  await EmailSequenceEnrollment.updateOne(
    { sequenceId, email: contact.email.toLowerCase() },
    {
      $setOnInsert: {
        sequenceId,
        email: contact.email.toLowerCase(),
        name: contact.name,
        courseTitle,
        studentId: contact.studentId,
        nextStepIndex: 0,
        nextSendAt: computeNextSendAt(enrolledAt, firstStep.delayDays),
        status: 'active',
        sentSteps: [],
      },
    },
    { upsert: true },
  );
}

/* ------------------------------------------------------------------ */
/* 5) Envoi des échéances dues + scheduler BullMQ repeatable            */
/* ------------------------------------------------------------------ */

/** Nombre max d'inscriptions traitées par passage cron (borne la charge). */
const MAX_ENROLLMENTS_PER_RUN = 500;

/**
 * Traite toutes les EmailSequenceEnrollment actives dont l'échéance est due
 * (nextSendAt <= now) : envoie l'étape courante via le service d'email
 * existant (gabarit HTML brut du bodyTemplate, interpolé), puis avance
 * l'inscription (étape suivante ou clôture). Best-effort par inscription — un
 * envoi raté n'interrompt pas les suivants ; l'échéance n'avance PAS en cas
 * d'échec d'envoi (retentera au prochain passage).
 */
export async function processDueEmailSequences(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const due = await EmailSequenceEnrollment.find({ status: 'active', nextSendAt: { $lte: now } })
    .limit(MAX_ENROLLMENTS_PER_RUN)
    .lean();

  let sent = 0;
  let failed = 0;

  for (const enrollment of due) {
    try {
      const sequence = await EmailSequence.findById(enrollment.sequenceId).lean();
      if (!sequence) {
        // Séquence supprimée entre-temps : clôture propre de l'inscription orpheline.
        await EmailSequenceEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'cancelled' } });
        continue;
      }
      const step = sequence.steps[enrollment.nextStepIndex];
      if (!step) {
        await EmailSequenceEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'completed' } });
        continue;
      }

      const html = interpolateTemplate(step.bodyTemplate, { name: enrollment.name, courseTitle: enrollment.courseTitle });
      const subject = interpolateTemplate(step.subject, { name: enrollment.name, courseTitle: enrollment.courseTitle });

      // Gabarit "sequence_step" (additif, packages/db/src/email/templates.ts) :
      // applique juste l'enveloppe de marque commune au contenu déjà interpolé.
      const result = await sendEmail(enrollment.email, 'sequence_step', {
        sequenceSubject: subject,
        sequenceHtml: html,
      });
      if (!result.ok) {
        failed += 1;
        logger.warn({ enrollmentId: String(enrollment._id), error: result.error }, 'email-sequence : envoi échoué, réessai au prochain passage');
        continue;
      }

      const advance = advanceEnrollment(sequence.steps, enrollment.nextStepIndex, enrollment.createdAt);
      await EmailSequenceEnrollment.updateOne(
        { _id: enrollment._id },
        {
          $set: { nextStepIndex: advance.nextStepIndex, nextSendAt: advance.nextSendAt, status: advance.status },
          $push: { sentSteps: { stepIndex: enrollment.nextStepIndex, sentAt: now } },
        },
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ enrollmentId: String(enrollment._id), err }, 'email-sequence : traitement de l\'échéance échoué');
    }
  }

  logger.info({ sent, failed }, 'email-sequence : passage cron terminé');
  return { sent, failed };
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée, même pattern que retention)*/
/* ------------------------------------------------------------------ */

/** Queue cron dédiée à l'envoi des séquences email (hors registre typé). */
export const EMAIL_SEQUENCE_QUEUE = 'email-sequence-cron';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const EMAIL_SEQUENCE_JOB = 'email-sequence-due-hourly';
/** Cadence par défaut : toutes les heures (surchargée par EMAIL_SEQUENCE_CRON). */
const DEFAULT_CRON = '0 * * * *';

interface EmailSequenceJobData {
  reason?: string;
}

let sequenceQueue: Queue<EmailSequenceJobData> | null = null;
let sequenceWorker: Worker<EmailSequenceJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler d'envoi des séquences : crée la queue, planifie le job
 * répétable (cron horaire par défaut) et démarre le worker qui exécute
 * processDueEmailSequences. Idempotent. À appeler depuis index.ts.
 */
export async function startEmailSequenceScheduler(
  cron: string = process.env.EMAIL_SEQUENCE_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (sequenceWorker) return;

  sequenceQueue = new Queue<EmailSequenceJobData>(EMAIL_SEQUENCE_QUEUE, { connection: bullConnection() });
  sequenceQueue.on('error', (err) => logger.error({ queue: EMAIL_SEQUENCE_QUEUE, err }, 'erreur queue email-sequence'));

  await sequenceQueue.add(
    EMAIL_SEQUENCE_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: EMAIL_SEQUENCE_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  sequenceWorker = new Worker<EmailSequenceJobData>(
    EMAIL_SEQUENCE_QUEUE,
    async (_job: Job<EmailSequenceJobData>) => processDueEmailSequences(),
    { connection: bullConnection(), concurrency: 1 },
  );
  sequenceWorker.on('failed', (job, err) =>
    logger.error({ queue: EMAIL_SEQUENCE_QUEUE, jobId: job?.id, err }, 'email-sequence : job en échec'),
  );
  sequenceWorker.on('error', (err) => logger.error({ queue: EMAIL_SEQUENCE_QUEUE, err }, 'erreur worker email-sequence'));

  logger.info({ cron }, 'scheduler email-sequence démarré');
}
/** Arrête proprement le scheduler (worker + queue). */
export async function stopEmailSequenceScheduler(): Promise<void> {
  await sequenceWorker?.close().catch(() => undefined);
  await sequenceQueue?.close().catch(() => undefined);
  sequenceWorker = null;
  sequenceQueue = null;
}

/* ------------------------------------------------------------------ */
/* Orchestration : génère + inscrit un cours à une séquence donnée      */
/* ------------------------------------------------------------------ */

/**
 * Crée (ou remplace) la séquence `kind` d'un cours et inscrit son roster de
 * contacts actuel (CRM externe si connecté, sinon Enrollment — voir
 * resolveSequenceContacts). Best-effort : ne jette jamais, retourne le nombre
 * de contacts inscrits.
 */
export async function createAndEnrollSequenceForCourse(
  courseId: string,
  kind: EmailSequenceKind,
): Promise<{ sequenceId: string; enrolled: number } | null> {
  const course = await Course.findById(courseId).select('_id userId title').lean();
  if (!course) {
    logger.warn({ courseId }, 'email-sequence : cours introuvable');
    return null;
  }

  const contacts = await resolveSequenceContacts(courseId);
  const generation = await generateEmailSequence({ courseTitle: course.title, kind, enrollmentCount: contacts.length });

  const sequenceDoc = await EmailSequence.create({
    userId: course.userId,
    courseId,
    kind,
    name: `${kind} — ${course.title}`,
    steps: generation.steps,
    active: true,
  });
  const sequenceId = String(sequenceDoc._id);

  let enrolled = 0;
  for (const contact of contacts) {
    try {
      await enrollContactInSequence(sequenceId, sequenceDoc, contact, course.title);
      enrolled += 1;
    } catch (err) {
      logger.warn({ courseId, contact: contact.email, err }, 'email-sequence : inscription contact échouée');
    }
  }

  logger.info({ courseId, kind, enrolled }, 'email-sequence : séquence créée et roster inscrit');
  return { sequenceId, enrolled };
}
