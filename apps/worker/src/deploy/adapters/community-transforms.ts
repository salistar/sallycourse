// Transformations PURES partagées par les adapters « cours communautaire »
// (Discord, Telegram) — Prompt 107. Aucune I/O réseau : testables hors-ligne
// (vitest). Regroupe :
//   - construction du calendrier de diffusion au compte-gouttes (drip content) ;
//   - mise en forme des messages texte + embeds Discord ;
//   - slug de salon Discord (nom de section → nom de canal valide).

import type { ILesson, ISection } from '../../shared.js';

/** Une leçon programmée dans le calendrier de diffusion (drip). */
export interface DripScheduleItem {
  /** Index absolu de la leçon dans ctx.lessons. */
  index: number;
  title: string;
  /** Jour de déblocage relatif au démarrage (0 = immédiat). */
  unlockDay: number;
}

/**
 * Construit le calendrier de diffusion au compte-gouttes : une leçon par jour
 * dans l'ordre, en partant de 0 (jour de lancement), sauf si `intervalDays`
 * espace davantage les déblocages (ex. 1 leçon tous les 2 jours). Pure —
 * aucun accès horloge : le mapping index → jour est déterministe.
 */
export function buildDripSchedule(
  lessons: Pick<ILesson, 'title'>[],
  intervalDays = 1,
) {
  const step = Math.max(1, Math.floor(intervalDays));
  return lessons.map(
    (lesson, index): DripScheduleItem => ({
      index,
      title: lesson.title,
      unlockDay: index * step,
    }),
  );
}

/** Slug ASCII simple, sûr comme nom de salon Discord (minuscules, tirets). */
export function slugifyChannelName(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'section'
  );
}

/** Nom de salon Discord préfixé par sa position (traçabilité de l'ordre). */
export function buildChannelName(section: Pick<ISection, 'title' | 'order'>): string {
  return `${String(section.order + 1).padStart(2, '0')}-${slugifyChannelName(section.title)}`;
}

/** Un embed Discord minimal (sous-ensemble du format officiel). */
export interface DiscordEmbed {
  title: string;
  description: string;
  /** Couleur décimale (0xRRGGBB). */
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
}

/** Couleur de marque par défaut des embeds de leçon (bleu SallyCourse). */
const EMBED_COLOR = 0x5865f2;

/**
 * Construit l'embed Discord d'une leçon (titre, résumé, durée, lien vidéo).
 * `videoUrl` est fournie par l'appelant (URL présignée, déjà résolue) — la
 * fonction reste pure et testable hors-ligne.
 */
export function buildLessonEmbed(
  lesson: Pick<ILesson, 'title' | 'summary' | 'generatedSummary' | 'durationMin'>,
  videoUrl?: string,
): DiscordEmbed {
  const description = (lesson.generatedSummary ?? lesson.summary ?? '').trim() || 'Nouvelle leçon disponible.';
  const fields: DiscordEmbed['fields'] = [];
  if (lesson.durationMin) {
    fields.push({ name: 'Durée', value: `${lesson.durationMin} min`, inline: true });
  }
  if (videoUrl) {
    fields.push({ name: 'Vidéo', value: videoUrl, inline: false });
  }
  return { title: lesson.title, description, color: EMBED_COLOR, fields };
}

/** Corps du message posté dans le canal Discord (texte + embed). */
export interface DiscordDripMessage {
  content: string;
  embeds: DiscordEmbed[];
}

/**
 * Construit le message Discord d'une leçon donnée dans le calendrier de drip.
 * `unlockDay` = 0 → message immédiat ; sinon mention de la date de déblocage
 * dans le texte d'accompagnement (le vrai scheduling est fait côté appelant).
 */
export function buildDiscordDripMessage(
  lesson: Pick<ILesson, 'title' | 'summary' | 'generatedSummary' | 'durationMin'>,
  item: Pick<DripScheduleItem, 'unlockDay'>,
  videoUrl?: string,
): DiscordDripMessage {
  const content =
    item.unlockDay === 0
      ? `Nouvelle leçon débloquée : **${lesson.title}**`
      : `Leçon débloquée (jour ${item.unlockDay}) : **${lesson.title}**`;
  return { content, embeds: [buildLessonEmbed(lesson, videoUrl)] };
}

/**
 * Construit le message Telegram (texte brut, HTML simple) d'une leçon du
 * calendrier de drip. Telegram n'a pas d'embeds natifs : on formate en gras/
 * lien via le sous-ensemble HTML supporté par l'API Bot (parse_mode=HTML).
 */
export function buildTelegramDripMessage(
  lesson: Pick<ILesson, 'title' | 'summary' | 'generatedSummary' | 'durationMin'>,
  item: Pick<DripScheduleItem, 'unlockDay'>,
  videoUrl?: string,
): string {
  const description = (lesson.generatedSummary ?? lesson.summary ?? '').trim() || 'Nouvelle leçon disponible.';
  const header =
    item.unlockDay === 0
      ? `🔓 <b>Nouvelle leçon débloquée : ${escapeHtml(lesson.title)}</b>`
      : `🔓 <b>Leçon débloquée (jour ${item.unlockDay}) : ${escapeHtml(lesson.title)}</b>`;
  const lines = [header, '', escapeHtml(description)];
  if (lesson.durationMin) lines.push('', `⏱ ${lesson.durationMin} min`);
  if (videoUrl) lines.push('', `🎬 ${videoUrl}`);
  return lines.join('\n');
}

/** Échappe les caractères réservés du sous-ensemble HTML Telegram. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
