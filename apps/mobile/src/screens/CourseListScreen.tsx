import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { CourseSummary } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Libellés + couleurs par statut de cours (cohérent avec le badge web). */
const STATUS_LABELS: Record<CourseSummary['status'], { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: '#94A3B8' },
  pending: { label: 'En attente', color: '#FBBF24' },
  generating: { label: 'Génération…', color: '#60A5FA' },
  ready: { label: 'Prêt', color: '#34D399' },
  failed: { label: 'Échec', color: '#F87171' },
  cancelled: { label: 'Annulé', color: '#64748B' },
};

interface Props {
  onOpenCourse: (courseId: string) => void;
}

/** Écran Liste des cours — GET /api/v1/courses, avec pull-to-refresh. */
export default function CourseListScreen({ onOpenCourse }: Props) {
  const { client, logout } = useAuth();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.listCourses();
      setCourses(list);
      setError(null);
    } catch {
      setError('Impossible de charger vos cours.');
    }
  }, [client]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchCourses();
      setLoading(false);
    })();
  }, [fetchCourses]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCourses();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366F1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mes cours</Text>
        <TouchableOpacity onPress={() => logout()}>
          <Text style={styles.logout}>Déconnexion</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={courses}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun cours pour le moment.</Text>
        }
        renderItem={({ item }) => {
          const status = STATUS_LABELS[item.status];
          return (
            <TouchableOpacity style={styles.card} onPress={() => onOpenCourse(item.id)}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <View style={styles.cardRow}>
                <View style={[styles.badge, { backgroundColor: status.color }]}>
                  <Text style={styles.badgeText}>{status.label}</Text>
                </View>
                <Text style={styles.cardMeta}>{item.difficulty} · {item.locale}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
    paddingHorizontal: 16,
    paddingTop: 56,
  },
  centered: {
    flex: 1,
    backgroundColor: '#0B1120',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  logout: {
    color: '#F87171',
    fontSize: 13,
  },
  error: {
    color: '#F87171',
    marginBottom: 12,
  },
  empty: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 40,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: '#0B1120',
    fontSize: 11,
    fontWeight: '700',
  },
  cardMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
});
