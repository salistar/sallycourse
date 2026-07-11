import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

/**
 * Écran Login — saisie de l'URL du serveur SallyCourse + clé API (générée
 * depuis Réglages > Clés API sur le web). Pas de mot de passe : cohérent avec
 * l'API publique v1 qui n'authentifie que par clé API.
 */
export default function LoginScreen() {
  const { login } = useAuth();
  const [baseUrl, setBaseUrl] = useState('https://app.sallycourse.com');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    const result = await login(baseUrl, apiKey);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Connexion impossible.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SallyCourse</Text>
      <Text style={styles.subtitle}>Connexion via clé API</Text>

      <Text style={styles.label}>URL du serveur</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://app.sallycourse.com"
        placeholderTextColor="#64748B"
      />

      <Text style={styles.label}>Clé API</Text>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="sk_..."
        placeholderTextColor="#64748B"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Se connecter</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        La clé API se génère depuis le dashboard web : Réglages → Clés API.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  error: {
    color: '#F87171',
    marginTop: 16,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6366F1',
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 24,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
