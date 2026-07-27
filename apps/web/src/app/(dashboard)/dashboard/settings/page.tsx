import { redirect } from 'next/navigation';

/**
 * Index des réglages : il n'y a pas d'écran « Paramètres » global, seulement des
 * sous-sections (compte, facturation, plateformes…). On redirige vers la première
 * (compte) pour que /dashboard/settings soit une URL valide (au lieu d'un 404).
 */
export default function SettingsIndexPage(): never {
  redirect('/dashboard/settings/account');
}
