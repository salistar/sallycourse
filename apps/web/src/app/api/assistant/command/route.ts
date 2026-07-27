import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Course as CourseModel, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { resolveAssistantCommand, type AssistantResolveContext } from '@/lib/assistant-actions';

/**
 * POST /api/assistant/command — assistant conversationnel du dashboard (P210).
 * RÉSOUT une intention en langage naturel et renvoie l'ACTION PROPOSÉE + la
 * route métier à appeler pour l'exécuter — mais N'EXÉCUTE JAMAIS : l'exécution
 * (qui coûte du quota / de l'argent LLM / publie en externe) reste au client,
 * APRÈS confirmation explicite, via la route existante décrite dans `execution`.
 * La résolution est déterministe (mots-clés) — aucune clé API requise.
 */

export const dynamic = 'force-dynamic';

// Résolution légère mais bornée (anti-abus).
const COMMAND_USER_LIMIT = { limit: 60, windowSec: 300 };
const COMMAND_IP_LIMIT = { limit: 120, windowSec: 300 };

const bodySchema = z.object({
  command: z.string().trim().min(1).max(500),
  /** Cours actif dans l'UI, s'il y en a un (les actions ciblées en dépendent). */
  currentCourseId: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`assistant-cmd:user:${user.id}`, COMMAND_USER_LIMIT),
    rateLimit(`assistant-cmd:ip:${ip}`, COMMAND_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de requêtes, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Commande invalide (1 à 500 caractères).', code: 'invalidCommandLength' }, { status: 400 });
  }

  const ctx: AssistantResolveContext = {};
  // Ownership : un cours courant n'est pris en compte que s'il appartient à
  // l'utilisateur (sinon on ignore le contexte — l'action ciblée retombera en
  // 'none' plutôt que de proposer une action sur le cours d'autrui).
  if (parsed.data.currentCourseId && isValidObjectId(parsed.data.currentCourseId)) {
    await connectDb();
    const course = await CourseModel.findOne({ _id: parsed.data.currentCourseId, userId: user.id })
      .select('_id title')
      .lean();
    if (course) {
      ctx.currentCourseId = String(course._id);
      ctx.currentCourseTitle = course.title;
    }
  }

  const plan = resolveAssistantCommand(parsed.data.command, ctx);

  // On renvoie l'action + comment l'exécuter — le client confirmera puis
  // appellera lui-même `execution.path`. Aucune mutation ici.
  return NextResponse.json({
    action: plan.action,
    execution: plan.execution,
    summary: plan.summary,
    requiresConfirmation: plan.requiresConfirmation,
  });
}
