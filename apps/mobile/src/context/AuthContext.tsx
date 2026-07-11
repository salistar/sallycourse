import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SallyCourseClient } from '../api/client';
import { clearCredentials, loadCredentials, saveCredentials } from '../api/storage';

/**
 * Contexte d'auth mobile — pas de vrai "login" email/mot de passe : l'API
 * publique v1 s'authentifie par clé API (Bearer/X-API-Key, cf. requireApiKeyUser
 * côté serveur). L'écran Login demande donc l'URL du serveur + la clé API
 * générée depuis le dashboard web (Réglages > Clés API), la vérifie avec un
 * appel léger, puis la persiste sur le device.
 */

interface AuthContextValue {
  client: SallyCourseClient | null;
  isReady: boolean;
  isAuthenticated: boolean;
  login: (baseUrl: string, apiKey: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<SallyCourseClient | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Tentative de restauration de session au démarrage.
  React.useEffect(() => {
    (async () => {
      const stored = await loadCredentials();
      if (stored) {
        setClient(new SallyCourseClient({ baseUrl: stored.baseUrl, apiKey: stored.apiKey }));
      }
      setIsReady(true);
    })();
  }, []);

  const login = useCallback(async (baseUrl: string, apiKey: string) => {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
    const trimmedKey = apiKey.trim();
    if (!trimmedUrl || !trimmedKey) {
      return { ok: false, error: 'URL du serveur et clé API requises.' };
    }

    const candidate = new SallyCourseClient({ baseUrl: trimmedUrl, apiKey: trimmedKey });
    try {
      const valid = await candidate.verifyCredentials();
      if (!valid) {
        return { ok: false, error: 'Clé API invalide ou expirée.' };
      }
    } catch {
      return { ok: false, error: 'Impossible de joindre le serveur SallyCourse.' };
    }

    await saveCredentials({ baseUrl: trimmedUrl, apiKey: trimmedKey });
    setClient(candidate);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await clearCredentials();
    setClient(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ client, isReady, isAuthenticated: client !== null, login, logout }),
    [client, isReady, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return ctx;
}
