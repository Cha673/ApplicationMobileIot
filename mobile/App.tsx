import React, { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoomsScreen } from './src/screens/RoomsScreen';
import { RoomDetailScreen } from './src/screens/RoomDetailScreen';
import type { Room } from './src/api';
import {
  configureNotifications,
  registerForPushNotificationsAsync,
} from './src/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // keep cached data 24h in memory
      staleTime: 1000 * 30,          // consider fresh for 30s
      retry: 1,
      networkMode: 'offlineFirst',   // always try, return cache on failure
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

export default function App(): React.ReactElement {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  useEffect(() => {
    configureNotifications();

    const receivedSubscription = Notifications.addNotificationReceivedListener(
      () => undefined,
    );
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      () => undefined,
    );

    registerForPushNotificationsAsync().catch(() => undefined);

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}
    >
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {selectedRoom ? selectedRoom.label : 'Campus connecté'}
          </Text>
        </View>
        <View style={styles.body}>
          {selectedRoom ? (
            <RoomDetailScreen
              room={selectedRoom}
              onBack={() => setSelectedRoom(null)}
            />
          ) : (
            <RoomsScreen onSelectRoom={setSelectedRoom} />
          )}
        </View>
      </SafeAreaView>
    </PersistQueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  body: { flex: 1, backgroundColor: '#f5f5f5' },
});
