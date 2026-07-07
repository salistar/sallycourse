import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// Données personnelles/légales : jamais de cache, runtime Node (accès Mongo).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/courses/[id]/ai-disclosure — mention « contenu généré par
 * IA » (P66). GET renvoie l'état courant ; POST l'enregistre (case à cocher
 * du flow de publication). Condition bloquante côté /api/courses/[id]/deploy
 * pour toute cible udemy.
 */

const bodySchema = z.object({
  accepted: z.boolean(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('aiDisclosureAccepted')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ accepted: Boolean(course.aiDisclosureAccepted) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();
  const updated = await CourseModel.findOneAndUpdate(
    { _id: id, userId: user.id },
    { $set: { aiDisclosureAccepted: parsed.data.accepted } },
    { new: true },
  )
    .select('aiDisclosureAccepted')
    .lean();
  if (!updated) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ accepted: Boolean(updated.aiDisclosureAccepted) });
}
