import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import {
  connectDb,
  AgencyClient,
  Course,
  CostRecord,
  User,
} from '@sallycourse/db';
import { aggregateAgencyBilling, type AgencyCostRow } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/agency/billing — facturation par client (Prompt 150, mode agence).
 * Agrège les CostRecord des cours rattachés à un AgencyClient de l'agence
 * connectée, en un rapport facturable SÉPARÉ par client (jamais mélangé aux
 * coûts propres de l'agence, ni entre clients). Réservé aux comptes agence.
 */

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const me = await User.findById(user.id).select('isAgency').lean();
  if (me?.isAgency !== true) {
    return apiError('agencyOnly');
  }

  const clients = await AgencyClient.find({ agencyUserId: user.id })
    .select('clientName clientEmail')
    .lean();
  if (clients.length === 0) {
    return NextResponse.json({ reports: [] });
  }

  // Cours générés au nom d'un des clients de cette agence.
  const clientIds = clients.map((c) => c._id);
  const courses = await Course.find({ userId: user.id, agencyClientId: { $in: clientIds } })
    .select('_id agencyClientId')
    .lean();
  if (courses.length === 0) {
    return NextResponse.json({ reports: [] });
  }

  const courseToClient = new Map(courses.map((c) => [String(c._id), String(c.agencyClientId)]));
  const courseIds = courses.map((c) => c._id);

  const costRows = await CostRecord.find({ courseId: { $in: courseIds } })
    .select('courseId estimatedUsd')
    .lean();

  const rows: AgencyCostRow[] = costRows
    .map((r) => {
      const agencyClientId = courseToClient.get(String(r.courseId));
      return agencyClientId ? { agencyClientId, courseId: String(r.courseId), estimatedUsd: r.estimatedUsd } : null;
    })
    .filter((r): r is AgencyCostRow => r !== null);

  const reports = aggregateAgencyBilling(
    rows,
    clients.map((c) => ({ id: String(c._id), clientName: c.clientName, clientEmail: c.clientEmail })),
  );

  return NextResponse.json({ reports });
}
