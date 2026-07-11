'use server';

import { revalidatePath } from 'next/cache';
import { connectDb, PromptTemplate } from '@sallycourse/db';
import { auth } from '@/lib/auth';
import { testPrompt, type PromptTestResult } from '@/lib/prompt-test';
import { findKeyInfo } from './known-keys';

/**
 * Actions serveur du playground de prompts admin (P93) : sauvegarde d'une
 * nouvelle version (versioning incrémental, une seule active par clé) et
 * test A/B (appelle Claude avec la version en cours de rédaction).
 */

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    throw new Error('Accès réservé aux administrateurs.');
  }
  return session.user.email ?? session.user.id ?? 'admin';
}

export interface PromptVersionRow {
  version: number;
  content: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

/** Historique complet d'une clé, du plus récent au plus ancien. */
export async function listVersionsAction(key: string): Promise<PromptVersionRow[]> {
  await requireAdmin();
  if (!findKeyInfo(key)) throw new Error('Clé de prompt inconnue.');

  await connectDb();
  const docs = await PromptTemplate.find({ key }).sort({ version: -1 }).lean();
  return docs.map((d) => ({
    version: d.version,
    content: d.content,
    isActive: d.isActive,
    createdBy: d.createdBy,
    createdAt: d.createdAt.toISOString(),
  }));
}

/**
 * Enregistre une nouvelle version active pour `key` (versioning incrémental :
 * dernière version + 1, désactivation de l'ancienne active — jamais de
 * suppression, l'historique reste disponible pour la comparaison A/B).
 */
export async function savePromptAction(key: string, content: string): Promise<{ version: number }> {
  const createdBy = await requireAdmin();
  if (!findKeyInfo(key)) throw new Error('Clé de prompt inconnue.');
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error('Le contenu du prompt ne peut pas être vide.');

  await connectDb();
  const last = await PromptTemplate.findOne({ key }).sort({ version: -1 }).lean();
  const nextVersion = (last?.version ?? 0) + 1;

  await PromptTemplate.updateMany({ key, isActive: true }, { $set: { isActive: false } });
  await PromptTemplate.create({ key, content: trimmed, version: nextVersion, isActive: true, createdBy });

  revalidatePath('/admin/prompts');
  return { version: nextVersion };
}

/** Réactive une version passée (rollback rapide) sans en créer de nouvelle. */
export async function activateVersionAction(key: string, version: number): Promise<void> {
  await requireAdmin();
  if (!findKeyInfo(key)) throw new Error('Clé de prompt inconnue.');

  await connectDb();
  const target = await PromptTemplate.findOne({ key, version });
  if (!target) throw new Error('Version introuvable.');

  await PromptTemplate.updateMany({ key, isActive: true }, { $set: { isActive: false } });
  target.isActive = true;
  await target.save();

  revalidatePath('/admin/prompts');
}

/**
 * Bouton « Tester » : appelle Claude avec system+user fournis par l'admin
 * (contenu en cours de rédaction dans l'éditeur, pas forcément sauvegardé).
 */
export async function testPromptAction(system: string, user: string): Promise<PromptTestResult> {
  await requireAdmin();
  return testPrompt(system, user);
}
