import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDb, Notification } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/notifications — notifications in-app de l'utilisateur (session-auth).
 * GET : liste récente + nombre de non-lus (cloche du header).
 * PATCH : marque une notification (ou toutes) comme lue(s).
 */

export const dynamic = 'force-dynamic';

/** Limite de la liste renvoyée à la cloche. */
const LIST_LIMIT = 30;

/** GET — dernières notifications + compteur de non-lus. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const [items, unreadCount] = await Promise.all([
    Notification.find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean(),
    Notification.countDocuments({ userId: user.id, read: false }),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: items.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      link: n.link ?? null,
      createdAt: n.createdAt,
    })),
  });
}

const patchSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
]);

/** PATCH — marque une notification (id) ou toutes (all) comme lues. */
export async function PATCH(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Requête invalide (fournir { id } ou { all: true }).' },
      { status: 400 },
    );
  }

  await connectDb();

  // Filtre borné à l'utilisateur : pas d'accès aux notifs d'autrui.
  const filter =
    'all' in parsed.data
      ? { userId: user.id, read: false }
      : { userId: user.id, _id: parsed.data.id };

  const res = await Notification.updateMany(filter, { $set: { read: true } });

  return NextResponse.json({ updated: res.modifiedCount ?? 0 });
}
