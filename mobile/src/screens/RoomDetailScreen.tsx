import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchRooms, fetchRoomHistory, type LatestMeasurement, type Room } from '../api';

interface Props {
  room: Room;
  onBack: () => void;
}

export function RoomDetailScreen({ room, onBack }: Props): React.ReactElement {
  const { data: rooms = [], isFetching: isRoomFetching, error: roomsError } = useQuery({
    queryKey: ['rooms'],
    queryFn: fetchRooms,
    refetchInterval: 5000,
  });
  const liveRoom = rooms.find(r => r.roomId === room.roomId) ?? room;

  const { data: history = [], isLoading, error, isFetching: isHistoryFetching } = useQuery({
    queryKey: ['history', room.roomId],
    queryFn: () => fetchRoomHistory(room.roomId),
    refetchInterval: 10000,
  });
  const { data: yesterdayAverage, error: averageError } = useQuery({
    queryKey: ["average-temperature-yesterday", room.roomId],
    queryFn: () => fetchYesterdayTemperatureAverage(room.roomId),
  });

  const appOffline = roomsError !== null && rooms.length > 0;
  const isOnline = !appOffline && liveRoom.isOnline;
  const isUpdating = (isRoomFetching || isHistoryFetching) && !isLoading;
  const offline = error !== null && history.length > 0;
  const m = liveRoom.latestMeasurement;

  const avgTemp = history.length > 0
    ? history.reduce((sum, e) => sum + e.temperature, 0) / history.length
    : null;
  const avgCo2 = history.length > 0
    ? history.reduce((sum, e) => sum + e.co2, 0) / history.length
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        {isUpdating && (
          <View style={styles.updatingRow}>
            <ActivityIndicator size="small" color="#4285F4" />
            <Text style={styles.updatingText}>Actualisation…</Text>
          </View>
        )}
      </View>

      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Mode hors ligne — dernière donnée du{" "}
            {m ? formatMeasurementTimestamp(m.observedAt) : "date inconnue"}
          </Text>
        </View>
      )}

      <Text style={styles.title}>{room.label}</Text>
      <Text style={styles.deviceId}>Capteur : {room.deviceId}</Text>

      <View style={[styles.statusBanner, isOnline ? styles.bannerOnline : styles.bannerOffline]}>
        <Text style={styles.statusText}>
          {isOnline ? 'Capteur en ligne' : 'Capteur hors ligne'}
        </Text>
      </View>

      {m ? (
        <View style={styles.latest}>
          <Text style={styles.sectionTitle}>Dernière mesure</Text>
          <View style={styles.measures}>
            <MeasureBlock
              value={`${m.temperature.toFixed(1)}`}
              unit="°C"
              label="Température"
            />
            <MeasureBlock
              value={`${Math.round(m.co2)}`}
              unit="ppm"
              label="CO₂"
            />
          </View>
          <Text style={styles.observedAt}>
            Donnée du {formatMeasurementTimestamp(m.observedAt)}
          </Text>
        </View>
      ) : (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>
            Aucune mesure disponible pour cette salle
          </Text>
        </View>
      )}

      {avgTemp !== null && avgCo2 !== null && (
        <View style={styles.latest}>
          <Text style={styles.sectionTitle}>Moyenne ({history.length} dernières mesures)</Text>
          <View style={styles.measures}>
            <MeasureBlock value={avgTemp.toFixed(1)} unit="°C" label="Température moy." />
            <MeasureBlock value={`${Math.round(avgCo2)}`} unit="ppm" label="CO₂ moy." />
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Historique (50 dernières mesures)</Text>

      <Text style={styles.sectionTitle}>
        {ROOM_HISTORY_LIMIT} dernières valeurs mesurées
      </Text>

      {isLoading && (
        <ActivityIndicator color="#4285F4" style={{ marginTop: 16 }} />
      )}

      {error && history.length === 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxTitle}>Historique non disponible hors ligne</Text>
          <Text style={styles.errorBoxBody}>
            Cet historique n'a jamais été téléchargé et ne se trouve pas dans le cache.
            Ouvrez cette salle une fois connecté à Internet pour le mettre en cache.
          </Text>
          <Text style={styles.errorBoxDetail}>
            {error instanceof Error ? error.message : 'Erreur inconnue'}
          </Text>
        </View>
      )}

      {!isLoading && history.length === 0 && !error && (
        <Text style={styles.emptyText}>Aucun historique disponible</Text>
      )}

      {history.map((entry, index) => (
        <View key={index} style={styles.historyRow}>
          <Text style={styles.historyTime}>
            {formatMeasurementTimestamp(entry.observedAt)}
          </Text>
          <Text style={styles.historyValue}>
            {entry.temperature.toFixed(1)} °C
          </Text>
          <Text style={styles.historyValue}>{Math.round(entry.co2)} ppm</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function MeasureBlock({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}): React.ReactElement {
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
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, paddingBottom: 32 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backBtn: {},
  backText: { color: '#4285F4', fontSize: 16 },
  updatingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  updatingText: { fontSize: 12, color: '#4285F4' },
  offlineBanner: {
    backgroundColor: "#f39c12",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  offlineText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a1a", marginBottom: 4 },
  deviceId: { fontSize: 13, color: "#888", marginBottom: 12 },
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
  errorBox: {
    backgroundColor: '#fde8e8',
    borderRadius: 10,
    padding: 16,
    marginTop: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#c0392b',
  },
  errorBoxTitle: { fontSize: 14, fontWeight: '700', color: '#c0392b', marginBottom: 6 },
  errorBoxBody: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 8 },
  errorBoxDetail: { fontSize: 11, color: '#999', fontStyle: 'italic' },
  emptyText: { color: '#aaa', fontStyle: 'italic', marginTop: 8 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  historyTime: { color: "#666", fontSize: 13 },
  historyValue: { color: "#1a1a1a", fontSize: 13, fontWeight: "500" },
});
