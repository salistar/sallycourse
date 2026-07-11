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
import type { NotificationItem } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Écran Notifications — liste simple depuis GET /api/notifications. */
export default function NotificationsScreen() {
  const { client } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.listNotifications();
      setItems(res.notifications);
      setUnreadCount(res.unreadCount);
      setError(null);
    } catch {
      setError('Impossible de charger les notifications.');
    }
  }, [client]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchNotifications();
      setLoading(false);
    })();
  }, [fetchNotifications]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
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
      <Text style={styles.title}>Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>Aucune notification.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, !item.read && styles.cardUnread]}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
          </View>
        )}
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
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
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
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardBody: {
    color: '#94A3B8',
    fontSize: 13,
  },
});
