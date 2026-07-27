import { AuditLog, User, connectDb } from '@sallycourse/db';
import { apiError } from '@/lib/api-error';
import { requireApiUser } from '@/lib/session';
import { auditLogsToCsv, buildAuditLogFilter } from '@/lib/audit-log-query';

// Export comptable : jamais de cache, runtime Node (accès Mongo).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit/export — export CSV du journal d'audit (P149), filtré
 * par les mêmes paramètres que la page /admin/audit (action, email, from, to).
 * Réservé aux admins. Limité aux 5000 entrées les plus récentes du filtre.
 */
const EXPORT_LIMIT = 5000;

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return apiError('adminOnly');
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? undefined;
  const email = searchParams.get('email') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  await connectDb();

  let userId: string | undefined;
  if (email?.trim()) {
    const match = await User.findOne({ email: email.trim().toLowerCase() }).select('_id').lean();
    userId = match ? String(match._id) : '__no_match__';
  }

  const filter = buildAuditLogFilter({ userId, action: action as never, from, to });
  const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(EXPORT_LIMIT).lean();

  const userIds = [...new Set(entries.filter((e) => e.userId).map((e) => String(e.userId)))];
  const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }).select('email').lean() : [];
  const emailById = new Map(users.map((u) => [String(u._id), u.email]));

  const csv = auditLogsToCsv(
    entries.map((e) => ({
      id: String(e._id),
      userId: e.userId ? String(e.userId) : undefined,
      userEmail: e.userId ? emailById.get(String(e.userId)) : undefined,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      ip: e.ip,
      userAgent: e.userAgent,
      createdAt: e.createdAt,
    })),
  );

  const filename = `sallycourse-audit-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
