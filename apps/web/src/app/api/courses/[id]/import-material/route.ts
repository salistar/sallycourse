import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import {
  detectSourceMaterialKind,
  sourceMaterialFilesSchema,
  storageKeys,
  uploadObject,
  type SourceMaterialFile,
} from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/courses/[id]/import-material — Import de contenu existant (Prompt 90,
 * RAG simple). Option avancée du formulaire de création : l'utilisateur
 * uploade un support (PDF/PPTX/Markdown) qui sera extrait et injecté en
 * contexte du prompt outline par le worker (lib/rag-extract.ts). Le fichier
 * source est stocké tel quel sur S3 ; seul un descripteur (clé, nom, type,
 * taille) est persisté sur Course.sourceMaterialFiles. Marque
 * Course.sourceMaterial=true (mode compliance Udemy P48).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Taille max par fichier (Mo) — un support de cours reste raisonnable. */
const MAX_MB = 30;
/** Nombre max de fichiers cumulés par cours (miroir sourceMaterialFilesSchema). */
const MAX_FILES = 10;

async function loadOwnedCourse(id: string, userId: string) {
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId }).select(
    '_id sourceMaterial sourceMaterialFiles',
  );
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }
  return course;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Requête multipart invalide.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Fichier manquant (champ « file »).' }, { status: 400 });
  }

  const kind = detectSourceMaterialKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json(
      { error: 'Format non supporté (PDF, PPTX ou Markdown attendu).' },
      { status: 415 },
    );
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Fichier trop lourd (max ${MAX_MB} Mo).` }, { status: 413 });
  }

  const existing = sourceMaterialFilesSchema.safeParse(course.sourceMaterialFiles ?? []);
  const currentFiles: SourceMaterialFile[] = existing.success ? existing.data : [];
  if (currentFiles.length >= MAX_FILES) {
    return NextResponse.json(
      { error: `Nombre maximal de supports atteint (${MAX_FILES}).` },
      { status: 422 },
    );
  }

  const key = storageKeys.course(id).sourceMaterial(`${Date.now()}-${file.name}`);
  const contentType =
    file.type ||
    (kind === 'pdf'
      ? 'application/pdf'
      : kind === 'pptx'
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'text/markdown');

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(key, buffer, contentType);
  } catch {
    return NextResponse.json(
      { error: 'Échec de l’enregistrement du fichier, réessayez.' },
      { status: 503 },
    );
  }

  const descriptor: SourceMaterialFile = {
    key,
    fileName: file.name,
    kind,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
  const nextFiles = [...currentFiles, descriptor];

  course.sourceMaterialFiles = nextFiles;
  course.sourceMaterial = true;
  await course.save();

  return NextResponse.json({ ok: true, files: nextFiles }, { status: 201 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  const parsed = sourceMaterialFilesSchema.safeParse(course.sourceMaterialFiles ?? []);
  return NextResponse.json({
    sourceMaterial: Boolean(course.sourceMaterial),
    files: parsed.success ? parsed.data : [],
  });
}
