import { NextResponse } from 'next/server';
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
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  if (parsed.data.platformCredentials) {
    const found = await PlatformCredential.find({
      _id: { $in: parsed.data.platformCredentials },
    })
      .select('_id')
      .lean();
    if (found.length !== parsed.data.platformCredentials.length) {
      return NextResponse.json(
        { error: 'Un ou plusieurs comptes plateforme référencés sont introuvables.' },
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
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
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
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
  }

  await connectDb();

  const deleted = await AgencyClient.findOneAndDelete({ _id: id, agencyUserId: user.id });
  if (!deleted) {
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
