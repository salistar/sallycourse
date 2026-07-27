import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, PlatformCredential, recordAudit } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp } from '@/lib/rate-limit';

/**
 * DELETE /api/platforms/[id] — déconnecte une plateforme (supprime le
 * credential chiffré). 404 (et non 403) si le credential n'appartient pas à
 * l'utilisateur, pour ne pas divulguer son existence.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('invalidId');
  }

  await connectDb();

  const existing = await PlatformCredential.findOne({ _id: id, userId: user.id })
    .select('platform accountLabel')
    .lean();

  const result = await PlatformCredential.deleteOne({ _id: id, userId: user.id });
  if (result.deletedCount === 0) {
    return apiError('credentialNotFound');
  }

  // Journal d'audit (P149) : suppression de credentials plateforme.
  void recordAudit({
    action: 'credentials.deleted',
    userId: user.id,
    targetType: 'platform_credential',
    targetId: id,
    ip: extractClientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    metadata: existing ? { platform: existing.platform, accountLabel: existing.accountLabel } : undefined,
  });

  return NextResponse.json({ ok: true });
}
