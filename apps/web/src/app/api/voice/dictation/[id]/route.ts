import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { dictationBriefSchema } from '@sallycourse/shared/voice-intent';
import { VoiceDictation, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/voice/dictation/[id] — polling de l'état d'une dictée (Prompt 210).
 * Le worker traite la dictée en asynchrone (aucun streaming temps réel possible
 * — le worker n'expose pas d'HTTP) ; le client interroge donc cet endpoint
 * jusqu'au statut 'ready' ou 'failed'. Ownership : un utilisateur ne voit QUE
 * ses propres dictées — 404 (convention du repo) si le document appartient à un
 * autre, pour ne pas révéler son existence.
 */

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Dictée introuvable.', code: 'dictationNotFound' }, { status: 404 });
  }

  await connectDb();

  const dictation = await VoiceDictation.findOne({ _id: id, userId: user.id })
    .select('status inputLang transcript brief error createdAt')
    .lean();
  if (!dictation) {
    return NextResponse.json({ error: 'Dictée introuvable.', code: 'dictationNotFound' }, { status: 404 });
  }

  // Ne renvoie le brief que s'il est conforme (garde-fou : un brief corrompu en
  // base ne casse pas le client — il verra un statut sans brief exploitable).
  const parsedBrief = dictation.brief ? dictationBriefSchema.safeParse(dictation.brief) : null;

  return NextResponse.json({
    id,
    status: dictation.status,
    inputLang: dictation.inputLang,
    transcript: dictation.transcript ?? null,
    brief: parsedBrief?.success ? parsedBrief.data : null,
    error: dictation.error ?? null,
  });
}
