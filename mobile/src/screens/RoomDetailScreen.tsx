import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { fetchRoomHistory, type LatestMeasurement, type Room } from '../api';

interface Props {
  room: Room;
  onBack: () => void;
}

export function RoomDetailScreen({ room, onBack }: Props): React.ReactElement {
  const [history, setHistory] = useState<LatestMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchRoomHistory(room.roomId);
      setHistory(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [room.roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  const m = room.latestMeasurement;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{room.label}</Text>
      <Text style={styles.deviceId}>Capteur : {room.deviceId}</Text>

      <View style={[styles.statusBanner, room.isOnline ? styles.bannerOnline : styles.bannerOffline]}>
        <Text style={styles.statusText}>
          {room.isOnline ? 'Capteur en ligne' : 'Capteur hors ligne'}
        </Text>
      </View>

      {m ? (
        <View style={styles.latest}>
          <Text style={styles.sectionTitle}>Dernière mesure</Text>
          <View style={styles.measures}>
            <MeasureBlock value={`${m.temperature.toFixed(1)}`} unit="°C" label="Température" />
            <MeasureBlock value={`${Math.round(m.co2)}`} unit="ppm" label="CO₂" />
          </View>
          <Text style={styles.observedAt}>
            Relevée le {new Date(m.observedAt).toLocaleString('fr-FR')}
          </Text>
        </View>
      ) : (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>Aucune mesure disponible pour cette salle</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Historique (50 dernières mesures)</Text>

      {loading && <ActivityIndicator color="#4285F4" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {!loading && !error && history.length === 0 && (
        <Text style={styles.emptyText}>Aucun historique disponible</Text>
      )}

      {history.map((entry, index) => (
        <View key={index} style={styles.historyRow}>
          <Text style={styles.historyTime}>
            {new Date(entry.observedAt).toLocaleTimeString('fr-FR')}
          </Text>
          <Text style={styles.historyValue}>{entry.temperature.toFixed(1)} °C</Text>
          <Text style={styles.historyValue}>{Math.round(entry.co2)} ppm</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function MeasureBlock({ value, unit, label }: { value: string; unit: string; label: string }): React.ReactElement {
  return (
    <View style={styles.measureBlock}>
      <View style={styles.measureRow}>
        <Text style={styles.measureValue}>{value}</Text>
        <Text style={styles.measureUnit}>{unit}</Text>
      </View>
      <Text style={styles.measureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  backBtn: { marginBottom: 16 },
  backText: { color: '#4285F4', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  deviceId: { fontSize: 13, color: '#888', marginBottom: 12 },
  statusBanner: { padding: 10, borderRadius: 8, marginBottom: 16 },
  bannerOnline: { backgroundColor: '#e8f5e9' },
  bannerOffline: { backgroundColor: '#fde8e8' },
  statusText: { textAlign: 'center', fontWeight: '500', color: '#444' },
  latest: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#555', marginBottom: 10 },
  measures: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  measureBlock: { alignItems: 'center' },
  measureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  measureValue: { fontSize: 36, fontWeight: '700', color: '#1a1a1a' },
  measureUnit: { fontSize: 16, color: '#666', marginBottom: 6 },
  measureLabel: { fontSize: 13, color: '#888' },
  observedAt: { fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 4 },
  noDataBox: { backgroundColor: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, alignItems: 'center' },
  noDataText: { color: '#bbb', fontStyle: 'italic' },
  errorText: { color: '#c0392b', marginTop: 8 },
  emptyText: { color: '#aaa', fontStyle: 'italic', marginTop: 8 },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  historyTime: { color: '#666', fontSize: 13 },
  historyValue: { color: '#1a1a1a', fontSize: 13, fontWeight: '500' },
});
