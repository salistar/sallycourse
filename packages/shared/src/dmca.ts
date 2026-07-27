// Anti-piratage — kit DMCA (Prompt 206). Logique PURE : à partir des infos d'un
// cours volé et de son propriétaire, on GÉNÈRE le texte de la notification de
// retrait (DMCA takedown) conforme au 17 U.S.C. §512(c)(3) ET une checklist des
// étapes/pièces à réunir. On N'ENVOIE RIEN automatiquement (décision produit) :
// l'auteur relit, complète et transmet lui-même au destinataire (hébergeur,
// plateforme, Google). Aucune I/O ici — la route/dashboard se contente d'appeler
// ce builder et d'afficher/télécharger le résultat.

export interface DmcaNoticeInput {
  /** Nom de l'auteur/ayant droit (déclarant). */
  claimantName: string;
  /** Email de contact du déclarant. */
  claimantEmail: string;
  /** Titre du cours protégé (œuvre originale). */
  courseTitle: string;
  /** URL canonique de l'œuvre originale (page LMS du cours). */
  originalUrl: string;
  /** URL(s) du contenu contrefaisant à retirer. */
  infringingUrls: string[];
  /** Destinataire de la notification (hébergeur / plateforme), si connu. */
  recipient?: string;
  /** Date de la notification (défaut : maintenant). */
  date?: Date;
}

export interface DmcaChecklistItem {
  id: string;
  label: string;
  /** Détail/rappel réglementaire. */
  detail: string;
  /** Vrai si l'élément est déjà satisfait par les données fournies. */
  done: boolean;
}

export interface DmcaKit {
  /** Corps de la notification, prêt à relire/compléter (Markdown/texte). */
  document: string;
  /** Étapes et pièces à réunir avant envoi. */
  checklist: DmcaChecklistItem[];
  /** Champs manquants bloquants (checklist non satisfaite). */
  missing: string[];
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEmail(value: string | undefined): boolean {
  return isNonEmpty(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Construit le kit DMCA (document + checklist). Déterministe : `date` injectable
 * pour des snapshots stables. Ne jette jamais — un champ manquant apparaît comme
 * un placeholder `[À COMPLÉTER]` dans le document et un item non coché (+ `missing`).
 */
export function buildDmcaKit(input: DmcaNoticeInput): DmcaKit {
  const date = input.date ?? new Date();
  const dateStr = date.toISOString().slice(0, 10);
  const infringing = (input.infringingUrls ?? []).map((u) => u.trim()).filter(isNonEmpty);
  const placeholder = (v: string | undefined, hint: string): string =>
    isNonEmpty(v) ? v!.trim() : `[À COMPLÉTER : ${hint}]`;

  const document = [
    `Objet : Notification de retrait pour violation de droit d'auteur (DMCA)`,
    `Date : ${dateStr}`,
    ``,
    `À l'attention de : ${placeholder(input.recipient, "hébergeur / plateforme")}`,
    ``,
    `Madame, Monsieur,`,
    ``,
    `Je soussigné(e) ${placeholder(input.claimantName, 'votre nom')}, agissant en qualité de ` +
      `titulaire des droits (ou de représentant autorisé) sur l'œuvre ci-dessous, vous notifie ` +
      `par la présente une demande de retrait au titre du Digital Millennium Copyright Act ` +
      `(17 U.S.C. §512(c)(3)).`,
    ``,
    `1. Œuvre protégée : « ${placeholder(input.courseTitle, 'titre du cours')} »,`,
    `   accessible à l'adresse originale : ${placeholder(input.originalUrl, 'URL de votre cours')}.`,
    ``,
    `2. Contenu contrefaisant dont je demande le retrait :`,
    ...(infringing.length > 0
      ? infringing.map((u) => `   - ${u}`)
      : [`   - [À COMPLÉTER : URL(s) du contenu volé]`]),
    ``,
    `3. Mes coordonnées : ${placeholder(input.claimantName, 'nom')}, ` +
      `${placeholder(input.claimantEmail, 'email de contact')}.`,
    ``,
    `4. Déclarations requises par la loi :`,
    `   - J'ai la conviction de bonne foi que l'usage du contenu signalé n'est autorisé ` +
      `ni par le titulaire des droits, ni par son agent, ni par la loi.`,
    `   - Les informations contenues dans la présente notification sont exactes et, sous peine ` +
      `de parjure, j'atteste être le titulaire des droits (ou autorisé à agir en son nom).`,
    ``,
    `Signature : ${placeholder(input.claimantName, 'nom')}`,
    `Date : ${dateStr}`,
  ].join('\n');

  const checklist: DmcaChecklistItem[] = [
    {
      id: 'claimant',
      label: 'Identité du titulaire des droits',
      detail: 'Nom complet du déclarant (ou représentant autorisé).',
      done: isNonEmpty(input.claimantName),
    },
    {
      id: 'contact',
      label: 'Coordonnées de contact valides',
      detail: 'Email (et idéalement adresse postale + téléphone) exigés par §512(c)(3).',
      done: isEmail(input.claimantEmail),
    },
    {
      id: 'original',
      label: "Preuve de l'œuvre originale",
      detail: "URL canonique du cours + date de création/publication pour établir l'antériorité.",
      done: isNonEmpty(input.originalUrl),
    },
    {
      id: 'infringing',
      label: 'URL(s) du contenu contrefaisant',
      detail: "Lien direct vers chaque copie à retirer (page, fichier ou vidéo).",
      done: infringing.length > 0,
    },
    {
      id: 'good-faith',
      label: 'Déclaration de bonne foi',
      detail: 'Incluse dans le document — à relire et signer.',
      done: true,
    },
    {
      id: 'perjury',
      label: 'Attestation sous peine de parjure',
      detail: 'Incluse dans le document — obligatoire pour la recevabilité.',
      done: true,
    },
    {
      id: 'recipient',
      label: 'Destinataire identifié',
      detail: "Agent DMCA de l'hébergeur/plateforme, ou formulaire Google si résultat de recherche.",
      done: isNonEmpty(input.recipient),
    },
    {
      id: 'send',
      label: 'Envoi manuel',
      detail: "Transmettez vous-même la notification — aucun envoi automatique n'est effectué.",
      done: false,
    },
  ];

  const missing = checklist.filter((i) => !i.done).map((i) => i.label);
  return { document, checklist, missing };
}
