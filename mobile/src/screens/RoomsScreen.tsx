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
import { fetchRooms, type Room } from '../api';

interface Props {
  onSelectRoom: (room: Room) => void;
}

export function RoomsScreen({ onSelectRoom }: Props): React.ReactElement {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchRooms();
      setRooms(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Chargement des salles…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Impossible de joindre le backend</Text>
        <Text style={styles.errorDetail}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void load(); }}>
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (rooms.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Aucune salle configurée</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rooms}
      keyExtractor={(item) => item.roomId}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => onSelectRoom(item)} activeOpacity={0.8}>
          <RoomRow room={item} />
        </TouchableOpacity>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.list}
    />
  );
}

function RoomRow({ room }: { room: Room }): React.ReactElement {
  const m = room.latestMeasurement;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.roomLabel}>{room.label}</Text>
        <View style={[styles.badge, room.isOnline ? styles.online : styles.offline]}>
          <Text style={styles.badgeText}>{room.isOnline ? 'En ligne' : 'Hors ligne'}</Text>
        </View>
      </View>
      {m ? (
        <View style={styles.measures}>
          <Measure value={`${m.temperature.toFixed(1)} °C`} label="Température" />
          <View style={styles.divider} />
          <Measure value={`${Math.round(m.co2)} ppm`} label="CO₂" />
        </View>
      ) : (
        <Text style={styles.noData}>Aucune mesure disponible</Text>
      )}
      {m && (
        <Text style={styles.timestamp}>
          {new Date(m.observedAt).toLocaleTimeString('fr-FR')}
        </Text>
      )}
    </View>
  );
}

function Measure({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View style={styles.measureBlock}>
      <Text style={styles.measureValue}>{value}</Text>
      <Text style={styles.measureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: { color: '#555', marginTop: 12 },
  errorIcon: { fontSize: 40 },
  errorTitle: { fontSize: 16, fontWeight: '600', color: '#c0392b', textAlign: 'center' },
  errorDetail: { fontSize: 13, color: '#888', textAlign: 'center' },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#4285F4',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyText: { color: '#888', fontStyle: 'italic' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  roomLabel: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  online: { backgroundColor: '#e8f5e9' },
  offline: { backgroundColor: '#fde8e8' },
  badgeText: { fontSize: 12, color: '#555' },
  measures: { flexDirection: 'row', alignItems: 'center' },
  measureBlock: { flex: 1, alignItems: 'center' },
  measureValue: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  measureLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  divider: { width: 1, height: 36, backgroundColor: '#e0e0e0' },
  noData: { color: '#bbb', fontStyle: 'italic', fontSize: 13, paddingVertical: 6 },
  timestamp: { fontSize: 11, color: '#bbb', textAlign: 'right', marginTop: 6 },
});
