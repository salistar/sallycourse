// Export xAPI (Experience API / Tin Can) basique pour clients entreprise
// (Prompt 144) — logique PURE, sans I/O. Génère un rapport de complétion au
// format "statements" JSON simplifié (sous-ensemble valide du spec xAPI :
// actor/verb/object/result/timestamp), suffisant pour import dans un LRS
// (Learning Record Store) externe. Pas de SCORM package (zip imsmanifest.xml)
// dans cette V1 — le nom du fichier documente l'intention pour une V2.

export interface XapiActorInput {
  studentId: string;
  name: string;
  email: string;
}

export interface XapiLessonCompletion {
  lessonId: string;
  lessonTitle: string;
  completedAt: Date | string;
  /** Score 0-100 si la leçon est un quiz. */
  score?: number;
  timeSpentSeconds?: number;
}

export interface XapiExportInput {
  actor: XapiActorInput;
  courseId: string;
  courseTitle: string;
  lessons: readonly XapiLessonCompletion[];
  /** Renseigné si le cours entier est complété (déclenche un statement "completed" additionnel). */
  courseCompletedAt?: Date | string | null;
  /** URL de base de la plateforme, sert de préfixe aux IRI d'objet (défaut : https://sallycourse.com). */
  baseUrl?: string;
}

/** Un statement xAPI simplifié (sous-ensemble du spec, JSON valide). */
export interface XapiStatement {
  actor: {
    objectType: 'Agent';
    name: string;
    mbox: string;
  };
  verb: {
    id: string;
    display: { 'fr-FR': string; 'en-US': string };
  };
  object: {
    objectType: 'Activity';
    id: string;
    definition: { name: { 'fr-FR': string }; type: string };
  };
  result?: {
    completion?: boolean;
    score?: { scaled: number; raw: number; min: number; max: number };
    duration?: string;
  };
  timestamp: string;
}

const VERB_COMPLETED = {
  id: 'http://adlnet.gov/expapi/verbs/completed',
  display: { 'fr-FR': 'a terminé', 'en-US': 'completed' },
};

const ACTIVITY_TYPE_LESSON = 'http://adlnet.gov/expapi/activities/lesson';
const ACTIVITY_TYPE_COURSE = 'http://adlnet.gov/expapi/activities/course';

/** Convertit un email en IRI mailto: requis par le champ `mbox` xAPI. */
function mbox(email: string): string {
  return email.includes('@') ? `mailto:${email}` : `mailto:${email}@sallycourse.local`;
}

/** Durée ISO 8601 (format xAPI, ex: PT90S) à partir de secondes. */
function isoDuration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  return `PT${Math.round(seconds)}S`;
}

function toIso(d: Date | string): string {
  return typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();
}

/**
 * Construit un statement xAPI minimal valide pour la complétion d'une leçon.
 * PURE — aucune dépendance externe (pas de lib xAPI, JSON simple).
 */
export function buildLessonStatement(
  actor: XapiActorInput,
  courseId: string,
  lesson: XapiLessonCompletion,
  baseUrl = 'https://sallycourse.com',
): XapiStatement {
  const statement: XapiStatement = {
    actor: {
      objectType: 'Agent',
      name: actor.name,
      mbox: mbox(actor.email),
    },
    verb: VERB_COMPLETED,
    object: {
      objectType: 'Activity',
      id: `${baseUrl}/learn/${courseId}/lesson/${lesson.lessonId}`,
      definition: { name: { 'fr-FR': lesson.lessonTitle }, type: ACTIVITY_TYPE_LESSON },
    },
    timestamp: toIso(lesson.completedAt),
  };

  const duration = isoDuration(lesson.timeSpentSeconds);
  const hasScore = typeof lesson.score === 'number';
  if (duration || hasScore) {
    statement.result = {
      completion: true,
      ...(duration ? { duration } : {}),
      ...(hasScore
        ? {
            score: {
              raw: lesson.score!,
              min: 0,
              max: 100,
              scaled: Math.round((lesson.score! / 100) * 100) / 100,
            },
          }
        : {}),
    };
  } else {
    statement.result = { completion: true };
  }

  return statement;
}

export interface XapiReport {
  version: '1.0.3';
  generatedAt: string;
  actor: { name: string; email: string };
  course: { id: string; title: string };
  statements: XapiStatement[];
}

/**
 * Génère le rapport complet (un statement par leçon complétée + un statement
 * de complétion du cours si applicable). Ordre déterministe : suit l'ordre
 * fourni dans `lessons`.
 */
export function generateXapiReport(input: XapiExportInput): XapiReport {
  const baseUrl = input.baseUrl ?? 'https://sallycourse.com';
  const statements = input.lessons.map((lesson) =>
    buildLessonStatement(input.actor, input.courseId, lesson, baseUrl),
  );

  if (input.courseCompletedAt) {
    statements.push({
      actor: {
        objectType: 'Agent',
        name: input.actor.name,
        mbox: mbox(input.actor.email),
      },
      verb: VERB_COMPLETED,
      object: {
        objectType: 'Activity',
        id: `${baseUrl}/learn/${input.courseId}`,
        definition: { name: { 'fr-FR': input.courseTitle }, type: ACTIVITY_TYPE_COURSE },
      },
      result: { completion: true },
      timestamp: toIso(input.courseCompletedAt),
    });
  }

  return {
    version: '1.0.3',
    generatedAt: new Date().toISOString(),
    actor: { name: input.actor.name, email: input.actor.email },
    course: { id: input.courseId, title: input.courseTitle },
    statements,
  };
}
