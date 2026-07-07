import type { CredentialKind, CredentialPlatform } from '@sallycourse/db';

/**
 * Métadonnées des plateformes de déploiement supportées : nature du secret
 * (mot de passe pour celles sans API publique, clé API/OAuth sinon) et champs
 * du formulaire d'ajout. Source unique partagée par la page settings et l'API.
 */

export interface PlatformField {
  /** Clé technique stockée dans le sac de credentials (chiffré). */
  name: string;
  label: string;
  /** Champ sensible → masqué (type password + redaction). */
  secret: boolean;
  placeholder?: string;
}

export interface PlatformMeta {
  id: CredentialPlatform;
  label: string;
  kind: CredentialKind;
  /** Description courte affichée sous le nom. */
  description: string;
  fields: PlatformField[];
}

const EMAIL_PASSWORD: PlatformField[] = [
  { name: 'email', label: 'Email du compte', secret: false, placeholder: 'vous@exemple.com' },
  { name: 'password', label: 'Mot de passe', secret: true },
];

const API_KEY: PlatformField[] = [{ name: 'apiKey', label: 'Clé API', secret: true }];

export const PLATFORMS: PlatformMeta[] = [
  {
    id: 'udemy',
    label: 'Udemy',
    kind: 'password',
    description: 'Marketplace de cours — connexion par email et mot de passe (pas d’API publique).',
    fields: EMAIL_PASSWORD,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    kind: 'oauth',
    description: 'Publication de vidéos via l’API Data v3 (jeton OAuth).',
    fields: [
      { name: 'accessToken', label: 'Access token', secret: true },
      { name: 'refreshToken', label: 'Refresh token', secret: true },
    ],
  },
  {
    id: 'teachable',
    label: 'Teachable',
    kind: 'apikey',
    description: 'LMS hébergé — clé API de l’espace administrateur.',
    fields: API_KEY,
  },
  {
    id: 'thinkific',
    label: 'Thinkific',
    kind: 'apikey',
    description: 'LMS hébergé — clé API + sous-domaine.',
    fields: [
      { name: 'apiKey', label: 'Clé API', secret: true },
      { name: 'subdomain', label: 'Sous-domaine', secret: false, placeholder: 'mon-ecole' },
    ],
  },
  {
    id: 'podia',
    label: 'Podia',
    kind: 'apikey',
    description: 'Plateforme de vente de cours — clé API.',
    fields: API_KEY,
  },
  {
    id: 'gumroad',
    label: 'Gumroad',
    kind: 'apikey',
    description: 'Vente de produits numériques — access token.',
    fields: [{ name: 'accessToken', label: 'Access token', secret: true }],
  },
  {
    id: 'skillshare',
    label: 'Skillshare',
    kind: 'password',
    description: 'Cours en ligne — connexion par email et mot de passe.',
    fields: EMAIL_PASSWORD,
  },
  {
    id: 'moodle',
    label: 'Moodle',
    kind: 'apikey',
    description: 'LMS auto-hébergé — URL du site + jeton de service web.',
    fields: [
      { name: 'baseUrl', label: 'URL du site', secret: false, placeholder: 'https://moodle.exemple.com' },
      { name: 'token', label: 'Jeton web service', secret: true },
    ],
  },
  {
    id: 'internal',
    label: 'LMS interne',
    kind: 'apikey',
    description: 'LMS SallyCourse — clé de service interne.',
    fields: API_KEY,
  },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

/** Métadonnées d'une plateforme par id, ou undefined si inconnue. */
export function getPlatformMeta(id: string): PlatformMeta | undefined {
  return PLATFORMS.find((p) => p.id === id);
}
