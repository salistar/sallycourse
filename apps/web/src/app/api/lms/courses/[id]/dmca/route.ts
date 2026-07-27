import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Course as CourseModel, User as UserModel } from '@sallycourse/db';
import { buildDmcaKit, getConfig } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/lms/courses/[id]/dmca (Prompt 206) — GÉNÈRE le kit DMCA (notification
 * de retrait + checklist) pour l'AUTEUR d'un cours dont une copie a été repérée
 * ailleurs. On n'envoie RIEN automatiquement (décision produit) : l'auteur relit,
 * complète et transmet lui-même. Réservé au propriétaire du cours (ownership →
 * 404). Aucune I/O lourde : appel du builder PUR + coordonnées de l'auteur.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** URL(s) du contenu contrefaisant à retirer. */
  infringingUrls: z.array(z.string().trim().url()).min(1).max(20),
  /** Destinataire (agent DMCA de l'hébergeur/plateforme), optionnel. */
  recipient: z.string().trim().max(300).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id: courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return apiError('notFound');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Fournissez au moins une URL du contenu contrefaisant.', code: 'infringingUrlRequired' }, { status: 400 });
  }

  await connectDb();

  // Ownership : seul l'auteur du cours peut générer son kit DMCA → 404 sinon.
  const course = await CourseModel.findOne({ _id: courseId, userId: user.id }).select('title').lean();
  if (!course) {
    return apiError('notFound');
  }

  const owner = await UserModel.findById(user.id).select('name email').lean();
  const appUrl = getConfig().APP_URL.replace(/\/$/, '');

  const kit = buildDmcaKit({
    claimantName: owner?.name ?? '',
    claimantEmail: owner?.email ?? user.email ?? '',
    courseTitle: course.title,
    originalUrl: `${appUrl}/learn/${courseId}`,
    infringingUrls: parsed.data.infringingUrls,
    recipient: parsed.data.recipient,
  });

  return NextResponse.json(kit);
}
