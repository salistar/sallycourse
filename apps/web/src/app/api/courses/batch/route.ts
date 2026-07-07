import { NextResponse } from 'next/server';
import { PLANS, type PlanId } from '@sallycourse/shared';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { createCourseForUser } from '@/lib/create-course';
import { getQuotaState } from '@/lib/quota';
import { parseBatchCsv, BATCH_MAX_ROWS } from '@/lib/batch-csv';

/**
 * POST /api/courses/batch — génération en lot (P63).
 * Corps JSON { csv: string }. Parse + valide le CSV (titre, niveau, langue,
 * plateformes), refuse au-delà du quota mensuel du plan, puis crée les cours un
 * par un via createCourseForUser (réservation atomique du crédit). La création
 * séquentielle espace naturellement les enqueues sur la queue outline ; la
 * concurrence des étapes lourdes (vidéo) reste gérée par la queue elle-même.
 * Renvoie la liste des cours créés + les lignes rejetées.
 */

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const csv = (body as { csv?: unknown })?.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    return NextResponse.json({ error: 'Champ « csv » manquant.' }, { status: 400 });
  }

  const parsed = parseBatchCsv(csv);
  if (parsed.fatal) {
    return NextResponse.json({ error: parsed.fatal }, { status: 400 });
  }
  if (parsed.valid.length === 0) {
    return NextResponse.json(
      { error: 'Aucune ligne valide à générer.', invalid: parsed.invalid },
      { status: 400 },
    );
  }

  await connectDb();

  // Refus AVANT création si le lot dépasse le quota restant du plan (P53).
  const userDoc = await UserModel.findById(user.id).select('plan quotaUsed').lean();
  if (!userDoc) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 401 });
  }
  const plan = (userDoc.plan ?? 'free') as PlanId;
  const quota = getQuotaState(userDoc);

  if (Number.isFinite(quota.remaining) && parsed.valid.length > quota.remaining) {
    return NextResponse.json(
      {
        error: `Lot de ${parsed.valid.length} cours refusé : quota restant ${quota.remaining}/${quota.limit} sur le plan ${plan}.`,
        code: 'quota_exceeded',
        remaining: quota.remaining,
        limit: quota.limit,
        requested: parsed.valid.length,
      },
      { status: 402 },
    );
  }

  // Création séquentielle : createCourseForUser réserve atomiquement le crédit,
  // ce qui protège aussi contre les envois concurrents (double soumission).
  const created: { id: string; title: string; status: string; line: number }[] = [];
  const failed: { line: number; title: string; reason: string }[] = [];

  for (const row of parsed.valid) {
    const result = await createCourseForUser(user.id!, plan, row.input);

    if (result.ok) {
      created.push({ id: result.id, title: result.title, status: result.status, line: row.line });
    } else {
      const reason =
        result.error.kind === 'quota'
          ? 'Quota mensuel atteint.'
          : result.error.kind === 'user_not_found'
            ? 'Utilisateur introuvable.'
            : 'Échec du démarrage de la génération.';
      failed.push({ line: row.line, title: row.input.title, reason });
      // Quota épuisé en cours de route (course concurrente) : inutile de continuer.
      if (result.error.kind === 'quota') break;
    }
  }

  return NextResponse.json(
    {
      created,
      failed,
      invalid: parsed.invalid,
      maxRows: BATCH_MAX_ROWS,
    },
    { status: created.length > 0 ? 201 : 502 },
  );
}
