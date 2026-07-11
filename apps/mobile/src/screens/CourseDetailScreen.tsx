import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CourseDetail } from '../api/client';
import { COURSE_POLL_INTERVAL_MS } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface Props {
  courseId: string;
  onBack: () => void;
}

/**
 * Écran Détail cours — GET /api/v1/courses/[id] avec polling toutes les 5s
 * (COURSE_POLL_INTERVAL_MS) tant que le cours est en génération, en l'absence
 * de SSE côté mobile (le web utilise SSE, cf. project notes ; ici on garde un
 * polling simple, robuste au backgrounding de l'app).
 */
export default function CourseDetailScreen({ courseId, onBack }: Props) {
  const { client } = useAuth();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!client) return;

    let cancelled = false;

    const fetchDetail = async () => {
      try {
        const detail = await client.getCourse(courseId);
        if (!cancelled) {
          setCourse(detail);
          setError(null);
          // Arrête le polling une fois le cours dans un état terminal.
          if (['ready', 'failed', 'cancelled'].includes(detail.status) && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        if (!cancelled) setError('Impossible de charger ce cours.');
      }
    };

    fetchDetail();
    intervalRef.current = setInterval(fetchDetail, COURSE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [client, courseId]);

  if (!course && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366F1" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Retour</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {course ? (
        <>
          <Text style={styles.title}>{course.title}</Text>
          <Text style={styles.meta}>
            {course.difficulty} · {course.locale} · {course.status}
          </Text>

          {course.generation ? (
            <View style={styles.progressBlock}>
              <Text style={styles.sectionTitle}>Génération : {course.generation.step}</Text>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, Math.max(0, course.generation.progress))}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>{course.generation.progress}%</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Déploiements</Text>
          {course.deployments.length === 0 ? (
            <Text style={styles.empty}>Aucun déploiement.</Text>
          ) : (
            course.deployments.map((d) => (
              <View key={d.platform} style={styles.deployRow}>
                <Text style={styles.deployPlatform}>{d.platform}</Text>
                <Text style={styles.deployStatus}>{d.status}</Text>
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  content: {
    padding: 16,
    paddingTop: 56,
  },
  centered: {
    flex: 1,
    backgroundColor: '#0B1120',
    justifyContent: 'center',
    alignItems: 'center',
  },
  back: {
    color: '#6366F1',
    fontSize: 14,
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  meta: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  progressBlock: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    backgroundColor: '#6366F1',
  },
  progressLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
  empty: {
    color: '#64748B',
  },
  deployRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  deployPlatform: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  deployStatus: {
    color: '#94A3B8',
    fontSize: 13,
  },
  error: {
    color: '#F87171',
    marginBottom: 12,
  },
});
