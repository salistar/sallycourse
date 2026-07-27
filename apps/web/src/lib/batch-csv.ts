import { z } from 'zod';
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client —
// ce fichier est importé par components/batch/batch-experience.tsx (client).
import {
  difficultySchema,
  localeSchema,
  type CreateCourseInput,
  type Difficulty,
} from '@sallycourse/shared/schemas/course';
import { VOICE_CATALOG_IDS } from '@sallycourse/shared/voice-catalog';

/**
 * Import CSV pour la génération en batch (P63). Parse maison (aucune dépendance) :
 * gère guillemets, virgules échappées, CRLF/LF et BOM. Chaque ligne est validée
 * par zod puis convertie en CreateCourseInput réutilisable par createCourseForUser.
 *
 * Colonnes attendues (en-tête obligatoire, ordre libre, casse ignorée) :
 *   title      (obligatoire) — titre du cours
 *   level      (optionnel)   — beginner | intermediate | advanced   [def. beginner]
 *   language   (optionnel)   — fr | en | ar                          [def. fr]
 *   platforms  (optionnel)   — liste séparée par des « ; » (ex. « udemy;youtube »)
 *
 * Colonnes avancées (2026-07-26, additif — mêmes options qu'à la création
 * unitaire) :
 *   duration   (optionnel)   — durée VISÉE du cours en minutes (15-720) ;
 *                              convertie en nombre de sections (≈18 min/section)
 *   sections   (optionnel)   — nombre de sections exact (3-30) ; prime sur duration
 *   voice      (optionnel)   — voix du catalogue (claire, henri, aria…) — une
 *                              seule identité vocale sur tout le cours
 *   ttsengine  (optionnel)   — chatterbox | qwen3
 *   imageengine(optionnel)   — sdxl | zimage
 *
 * Synonymes d'en-têtes tolérés : niveau→level, langue/locale→language,
 * plateformes/platform→platforms, titre→title, durée/duree/minutes→duration,
 * section→sections, voix→voice, moteur_voix/moteurvoix→ttsengine,
 * modele_image/modèle_image/image→imageengine.
 */

/** Nombre maximal de lignes acceptées dans un fichier (garde-fou DoS/UX). */
export const BATCH_MAX_ROWS = 200;

/** Niveaux acceptés en entrée, avec synonymes FR courants. */
const LEVEL_ALIASES: Record<string, Difficulty> = {
  beginner: 'beginner',
  débutant: 'beginner',
  debutant: 'beginner',
  intermediate: 'intermediate',
  intermédiaire: 'intermediate',
  intermediaire: 'intermediate',
  advanced: 'advanced',
  avancé: 'advanced',
  avance: 'advanced',
};

/** Clés canoniques des colonnes reconnues. */
type BatchColumn =
  | 'title'
  | 'level'
  | 'language'
  | 'platforms'
  | 'duration'
  | 'sections'
  | 'voice'
  | 'ttsengine'
  | 'imageengine';

/** Mappe un nom d'en-tête (normalisé) vers une clé canonique, ou null si inconnu. */
function canonicalHeader(raw: string): BatchColumn | null {
  const h = raw.trim().toLowerCase();
  if (h === 'title' || h === 'titre') return 'title';
  if (h === 'level' || h === 'niveau' || h === 'difficulty' || h === 'difficulté') return 'level';
  if (h === 'language' || h === 'langue' || h === 'locale' || h === 'lang') return 'language';
  if (h === 'platforms' || h === 'platform' || h === 'plateformes' || h === 'plateforme') {
    return 'platforms';
  }
  if (h === 'duration' || h === 'durée' || h === 'duree' || h === 'minutes') return 'duration';
  if (h === 'sections' || h === 'section') return 'sections';
  if (h === 'voice' || h === 'voix') return 'voice';
  if (h === 'ttsengine' || h === 'moteur_voix' || h === 'moteurvoix' || h === 'tts') return 'ttsengine';
  if (h === 'imageengine' || h === 'modele_image' || h === 'modèle_image' || h === 'modeleimage' || h === 'image') {
    return 'imageengine';
  }
  return null;
}

/**
 * Durée visée (minutes) → nombre de sections (≈18 min de contenu par section,
 * calé sur les mesures réelles : une section ≈ 3-4 leçons ≈ 15-20 min). Borné
 * aux limites du produit (3-30 sections). Ex. : 90 min → 5 sections.
 */
export function sectionsForTargetMinutes(minutes: number): number {
  return Math.min(30, Math.max(3, Math.round(minutes / 18)));
}

/**
 * Découpe une ligne CSV en champs en respectant les guillemets doubles.
 * `"a,b"` reste un champ ; `""` à l'intérieur d'un champ cité = guillemet
 * littéral. Ne gère pas les retours-ligne dans un champ cité (une ligne logique
 * = une ligne physique) — suffisant pour un import titre/niveau/langue.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // guillemet échappé
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Schéma zod d'une ligne brute (après mapping des colonnes). */
const rowSchema = z.object({
  title: z
    .string({ required_error: 'Titre manquant.' })
    .trim()
    .min(3, 'Titre trop court (min. 3 caractères).')
    .max(120, 'Titre trop long (max. 120 caractères).'),
  level: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return 'beginner' as Difficulty;
      const mapped = LEVEL_ALIASES[v.toLowerCase()];
      if (!mapped) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Niveau invalide : « ${v} » (attendu beginner/intermediate/advanced).`,
        });
        return z.NEVER;
      }
      return mapped;
    })
    .pipe(difficultySchema),
  language: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : 'fr'))
    .pipe(localeSchema),
  platforms: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(';')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
    ),
  // ── Colonnes avancées (2026-07-26, additives) ─────────────────────────────
  duration: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const minutes = Number.parseInt(v, 10);
      if (!Number.isFinite(minutes) || minutes < 15 || minutes > 720) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Durée invalide : « ${v} » (attendu 15-720 minutes).`,
        });
        return z.NEVER;
      }
      return minutes;
    }),
  sections: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 3 || n > 30) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Nombre de sections invalide : « ${v} » (attendu 3-30).`,
        });
        return z.NEVER;
      }
      return n;
    }),
  voice: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const id = v.toLowerCase();
      if (!(VOICE_CATALOG_IDS as readonly string[]).includes(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Voix inconnue : « ${v} » (attendu : ${VOICE_CATALOG_IDS.join(', ')}).`,
        });
        return z.NEVER;
      }
      return id;
    }),
  ttsengine: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const e = v.toLowerCase();
      if (e !== 'chatterbox' && e !== 'qwen3') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Moteur de voix invalide : « ${v} » (attendu chatterbox/qwen3).`,
        });
        return z.NEVER;
      }
      return e as 'chatterbox' | 'qwen3';
    }),
  imageengine: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const e = v.toLowerCase();
      if (e !== 'sdxl' && e !== 'zimage') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Modèle d'image invalide : « ${v} » (attendu sdxl/zimage).`,
        });
        return z.NEVER;
      }
      return e as 'sdxl' | 'zimage';
    }),
});

/** Une ligne valide, prête pour createCourseForUser. */
export interface ValidBatchRow {
  /** Numéro de ligne (1-based, en-tête exclu) pour les messages à l'utilisateur. */
  line: number;
  input: CreateCourseInput;
}

/** Une ligne rejetée avec sa raison. */
export interface InvalidBatchRow {
  line: number;
  /** Contenu brut de la ligne (tronqué à l'affichage côté UI). */
  raw: string;
  errors: string[];
}

export interface ParsedBatch {
  valid: ValidBatchRow[];
  invalid: InvalidBatchRow[];
  /** Erreur globale bloquante (en-tête absent, fichier vide, trop de lignes). */
  fatal?: string;
}

/**
 * Parse et valide un CSV complet. Ne lève jamais : renvoie les lignes valides,
 * les rejets détaillés et une éventuelle erreur fatale (structure invalide).
 */
export function parseBatchCsv(content: string): ParsedBatch {
  // Retrait du BOM UTF-8 éventuel, normalisation des fins de ligne.
  const text = content.replace(/^﻿/, '');
  const rawLines = text.split(/\r\n|\r|\n/);

  // Lignes non vides uniquement (on ignore les lignes blanches n'importe où).
  const lines = rawLines.filter((l) => l.trim() !== '');

  const header = lines[0];
  if (header === undefined) {
    return { valid: [], invalid: [], fatal: 'Fichier vide.' };
  }

  // Première ligne = en-tête. On construit l'index colonne → position.
  const headerCells = splitCsvLine(header);
  const columnIndex: Partial<Record<BatchColumn, number>> = {};
  headerCells.forEach((cell, i) => {
    const key = canonicalHeader(cell);
    if (key && columnIndex[key] === undefined) columnIndex[key] = i;
  });

  if (columnIndex.title === undefined) {
    return {
      valid: [],
      invalid: [],
      fatal: 'En-tête invalide : colonne « title » (ou « titre ») obligatoire.',
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > BATCH_MAX_ROWS) {
    return {
      valid: [],
      invalid: [],
      fatal: `Trop de lignes : ${dataLines.length} (maximum ${BATCH_MAX_ROWS}).`,
    };
  }

  const valid: ValidBatchRow[] = [];
  const invalid: InvalidBatchRow[] = [];

  dataLines.forEach((rowText, i) => {
    const lineNo = i + 1; // 1-based, en-tête exclu
    const cells = splitCsvLine(rowText);
    const cellAt = (idx: number | undefined): string | undefined =>
      idx === undefined ? undefined : cells[idx];

    const candidate = {
      title: cellAt(columnIndex.title),
      level: cellAt(columnIndex.level),
      language: cellAt(columnIndex.language),
      platforms: cellAt(columnIndex.platforms),
      duration: cellAt(columnIndex.duration),
      sections: cellAt(columnIndex.sections),
      voice: cellAt(columnIndex.voice),
      ttsengine: cellAt(columnIndex.ttsengine),
      imageengine: cellAt(columnIndex.imageengine),
    };

    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) {
      invalid.push({
        line: lineNo,
        raw: rowText,
        errors: parsed.error.issues.map((issue) => issue.message),
      });
      return;
    }

    // sections explicite > durée visée (convertie) > défaut produit (absent).
    const approxSections =
      parsed.data.sections ??
      (parsed.data.duration !== undefined ? sectionsForTargetMinutes(parsed.data.duration) : undefined);

    valid.push({
      line: lineNo,
      input: {
        title: parsed.data.title,
        difficulty: parsed.data.level,
        locale: parsed.data.language,
        targetPlatforms: parsed.data.platforms,
        ...(approxSections !== undefined ? { approxSections } : {}),
        ...(parsed.data.voice ? { voiceId: parsed.data.voice } : {}),
        ...(parsed.data.ttsengine ? { ttsEngine: parsed.data.ttsengine } : {}),
        ...(parsed.data.imageengine ? { imageEngine: parsed.data.imageengine } : {}),
      },
    });
  });

  return { valid, invalid };
}
