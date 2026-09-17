import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRooms, formatMeasurementTimestamp, type Room } from "../api";
import { showDataUpdatedNotification } from "../notifications";

interface Props {
  onSelectRoom: (room: Room) => void;
}

export function RoomsScreen({ onSelectRoom }: Props): React.ReactElement {
  const queryClient = useQueryClient();

  const {
    data: rooms = [],
    isLoading,
    error,
    isRefetching,
  } = useQuery({
    queryKey: ["rooms"],
    queryFn: fetchRooms,
    refetchInterval: 5000,
  });
  const previousMeasurements = useRef<Record<string, string | null> | null>(
    null,
  );

  useEffect(() => {
    if (isLoading || error || rooms.length === 0) {
      return;
    }

    const currentMeasurements = Object.fromEntries(
      rooms.map((room) => [
        room.roomId,
        room.latestMeasurement?.observedAt ?? null,
      ]),
    );

    if (previousMeasurements.current !== null) {
      const updatedRoomLabels = rooms
        .filter(
          (room) =>
            room.latestMeasurement !== null &&
            room.latestMeasurement.observedAt !==
              previousMeasurements.current?.[room.roomId],
        )
        .map((room) => room.label);

      if (updatedRoomLabels.length > 0) {
        void showDataUpdatedNotification(updatedRoomLabels);
      }
    }

    previousMeasurements.current = currentMeasurements;
  }, [error, isLoading, rooms]);

  const offline = error !== null && rooms.length > 0;

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["rooms"] });
  }, [queryClient]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Chargement des salles…</Text>
      </View>
    );
  }

  if (error && rooms.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Impossible de joindre le backend</Text>
        <Text style={styles.errorDetail}>
          {error instanceof Error ? error.message : "Erreur inconnue"}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() =>
            void queryClient.invalidateQueries({ queryKey: ["rooms"] })
          }
        >
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
    <View style={styles.container}>
      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Mode hors ligne — dernières données connues
          </Text>
        </View>
      )}
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.roomId}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => onSelectRoom(item)}
            activeOpacity={0.8}
          >
            <RoomRow room={item} appOffline={offline} />
          </TouchableOpacity>
        )}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

function RoomRow({
  room,
  appOffline,
}: {
  room: Room;
  appOffline: boolean;
}): React.ReactElement {
  const m = room.latestMeasurement;
  const isOnline = !appOffline && room.isOnline;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.roomLabel}>{room.label}</Text>
        <View style={[styles.badge, isOnline ? styles.online : styles.offline]}>
          <Text style={styles.badgeText}>
            {isOnline ? "En ligne" : "Hors ligne"}
          </Text>
        </View>
      </View>
      {m ? (
        <View style={styles.measures}>
          <Measure
            value={`${m.temperature.toFixed(1)} °C`}
            label="Température"
          />
          <View style={styles.divider} />
          <Measure value={`${Math.round(m.co2)} ppm`} label="CO₂" />
        </View>
      ) : (
        <Text style={styles.noData}>Aucune mesure disponible</Text>
      )}
      {m && (
        <Text style={styles.timestamp}>
          Donnée du {formatMeasurementTimestamp(m.observedAt)}
        </Text>
      )}
    </View>
  );
}

function Measure({
  value,
  label,
}: {
  value: string;
  label: string;
}): React.ReactElement {
  return (
    <View style={styles.measureBlock}>
      <Text style={styles.measureValue}>{value}</Text>
      <Text style={styles.measureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: 8 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  offlineBanner: {
    backgroundColor: "#f39c12",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  loadingText: { color: "#555", marginTop: 12 },
  errorIcon: { fontSize: 40 },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#c0392b",
    textAlign: "center",
  },
  errorDetail: { fontSize: 13, color: "#888", textAlign: "center" },
  retryButton: {
    marginTop: 8,
    backgroundColor: "#4285F4",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: "#fff", fontWeight: "600" },
  emptyText: { color: "#888", fontStyle: "italic" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  roomLabel: { fontSize: 17, fontWeight: "600", color: "#1a1a1a" },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  online: { backgroundColor: "#e8f5e9" },
  offline: { backgroundColor: "#fde8e8" },
  badgeText: { fontSize: 12, color: "#555" },
  measures: { flexDirection: "row", alignItems: "center" },
  measureBlock: { flex: 1, alignItems: "center" },
  measureValue: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  measureLabel: { fontSize: 12, color: "#888", marginTop: 2 },
  divider: { width: 1, height: 36, backgroundColor: "#e0e0e0" },
  noData: {
    color: "#bbb",
    fontStyle: "italic",
    fontSize: 13,
    paddingVertical: 6,
  },
  timestamp: { fontSize: 11, color: "#bbb", textAlign: "right", marginTop: 6 },
});
