import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistance locale des credentials (clé API + URL de base) sur le device.
 * Simple wrapper AsyncStorage — pas de chiffrement supplémentaire ici (hors
 * scope du prompt 98), à durcir plus tard (expo-secure-store) si besoin.
 */

const STORAGE_KEY_API_KEY = 'sallycourse:apiKey';
const STORAGE_KEY_BASE_URL = 'sallycourse:baseUrl';

export interface StoredCredentials {
  apiKey: string;
  baseUrl: string;
}

/** Sauvegarde la clé API et l'URL de base après un login réussi. */
export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_API_KEY, creds.apiKey);
  await AsyncStorage.setItem(STORAGE_KEY_BASE_URL, creds.baseUrl);
}

/** Relit les credentials stockées (null si jamais connecté / après logout). */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  const [apiKey, baseUrl] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY_API_KEY),
    AsyncStorage.getItem(STORAGE_KEY_BASE_URL),
  ]);
  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl };
}

/** Efface les credentials (déconnexion). */
export async function clearCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEY_API_KEY, STORAGE_KEY_BASE_URL]);
}
