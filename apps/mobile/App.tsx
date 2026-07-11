import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import CourseListScreen from './src/screens/CourseListScreen';
import CourseDetailScreen from './src/screens/CourseDetailScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';

/**
 * Navigation minimale volontairement sans librairie de routing (pas de
 * react-navigation déclarée dans les deps de ce package) : une simple machine
 * à états suffit pour les 4 écrans du prompt 98. À remplacer par
 * react-navigation si l'app grandit.
 */
type Route =
  | { name: 'courses' }
  | { name: 'course-detail'; courseId: string }
  | { name: 'notifications' };

function AppShell() {
  const { isReady, isAuthenticated } = useAuth();
  const [route, setRoute] = useState<Route>({ name: 'courses' });

  if (!isReady) {
    return <View style={styles.root} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.screenArea}>
        {route.name === 'courses' && (
          <CourseListScreen
            onOpenCourse={(courseId) => setRoute({ name: 'course-detail', courseId })}
          />
        )}
        {route.name === 'course-detail' && (
          <CourseDetailScreen
            courseId={route.courseId}
            onBack={() => setRoute({ name: 'courses' })}
          />
        )}
        {route.name === 'notifications' && <NotificationsScreen />}
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => setRoute({ name: 'courses' })}>
          <Text style={[styles.tabLabel, route.name !== 'notifications' && styles.tabLabelActive]}>
            Cours
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setRoute({ name: 'notifications' })}
        >
          <Text style={[styles.tabLabel, route.name === 'notifications' && styles.tabLabelActive]}>
            Notifications
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <AppShell />
      </SafeAreaView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  root: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  screenArea: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingVertical: 10,
    backgroundColor: '#0B1120',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
  },
  tabLabel: {
    color: '#64748B',
    fontSize: 13,
  },
  tabLabelActive: {
    color: '#6366F1',
    fontWeight: '700',
  },
});
