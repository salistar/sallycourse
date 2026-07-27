import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, AgencyClient, PlatformCredential } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/agency/clients/[id] — mode agence (Prompt 150).
 * PATCH  : met à jour le libellé/email/credentials d'un client.
 * DELETE : supprime un client de l'agence (les cours déjà générés en son nom
 * conservent leur agencyClientId — ils cessent simplement d'être ré-utilisables
 * pour un nouveau déploiement tant qu'un nouveau client n'est pas recréé).
 * Seul le PROPRIÉTAIRE agence (agencyUserId) peut lire/modifier ses clients.
 */

const patchSchema = z.object({
  clientName: z.string().trim().min(1).max(120).optional(),
  clientEmail: z.string().trim().email().optional(),
  platformCredentials: z.array(z.string().trim().min(1)).max(50).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('clientNotFound');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  if (parsed.data.platformCredentials) {
    // Ownership : les credentials référencés doivent appartenir à l'agence
    // (userId), sinon un client pourrait pointer l'ObjectId d'un credential
    // d'un autre tenant (faille cross-tenant de publication). Cf. route POST.
    const found = await PlatformCredential.find({
      _id: { $in: parsed.data.platformCredentials },
      userId: user.id,
    })
      .select('_id')
      .lean();
    if (found.length !== parsed.data.platformCredentials.length) {
      return NextResponse.json(
        { error: 'Un ou plusieurs comptes plateforme référencés sont introuvables.', code: 'platformAccountsNotFound' },
        { status: 404 },
      );
    }
  }

  const updated = await AgencyClient.findOneAndUpdate(
    { _id: id, agencyUserId: user.id },
    { $set: parsed.data },
    { new: true },
  ).lean();

  if (!updated) {
    return apiError('clientNotFound');
  }

  return NextResponse.json({
    client: {
      id: String(updated._id),
      clientName: updated.clientName,
      clientEmail: updated.clientEmail,
      platformCredentials: updated.platformCredentials.map(String),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('clientNotFound');
  }

  await connectDb();

  const deleted = await AgencyClient.findOneAndDelete({ _id: id, agencyUserId: user.id });
  if (!deleted) {
    return apiError('clientNotFound');
  }

  return NextResponse.json({ ok: true });
}
