import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { ADMIN_CRON_TRIGGERS, ADMIN_CRON_KEYS } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { triggerAdminCron } from '@/lib/queues';

// Enfilage BullMQ : runtime Node, jamais de cache.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  key: z.enum(ADMIN_CRON_KEYS as [string, ...string[]]),
});

/**
 * POST /api/admin/cron — déclenche MANUELLEMENT l'un des crons du worker (P57).
 * Réservé aux admins. Le corps `{ key }` identifie le cron (cf.
 * ADMIN_CRON_TRIGGERS) ; on enfile un job `${job}:manual` sur sa queue.
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return apiError('adminOnly');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Cron inconnu.', code: 'invalidInput' }, { status: 400 });
  }

  const trigger = ADMIN_CRON_TRIGGERS.find((t) => t.key === parsed.data.key);
  if (!trigger) {
    return Response.json({ error: 'Cron inconnu.', code: 'invalidInput' }, { status: 400 });
  }

  try {
    await triggerAdminCron(trigger.queue, trigger.job);
  } catch {
    return Response.json({ error: 'Déclenchement impossible pour le moment.', code: 'cronTriggerFailed' }, { status: 503 });
  }

  return Response.json({ ok: true, key: trigger.key });
}
