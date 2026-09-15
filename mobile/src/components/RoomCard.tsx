import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Room } from '../api';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface Props {
  room: Room;
  onPress: () => void;
}

export function RoomCard({ room, onPress }: Props): React.ReactElement {
  const m = room.latestMeasurement;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{room.label}</Text>
        <View style={[styles.badge, room.isOnline ? styles.online : styles.offline]}>
          <Text style={styles.badgeText}>{room.isOnline ? 'En ligne' : 'Hors ligne'}</Text>
        </View>
      </View>

      {m ? (
        <View style={styles.measures}>
          <View style={styles.measure}>
            <Text style={styles.measureValue}>{m.temperature.toFixed(1)}</Text>
            <Text style={styles.measureUnit}>°C</Text>
            <Text style={styles.measureLabel}>Température</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.measure}>
            <Text style={styles.measureValue}>{Math.round(m.co2)}</Text>
            <Text style={styles.measureUnit}>ppm</Text>
            <Text style={styles.measureLabel}>CO₂</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.noData}>Aucune mesure disponible</Text>
      )}

      {m && (
        <Text style={styles.timestamp}>Relevé à {formatDate(m.observedAt)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  online: {
    backgroundColor: '#e6f4ea',
  },
  offline: {
    backgroundColor: '#fce8e6',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#555',
  },
  measures: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  measure: {
    alignItems: 'center',
    flex: 1,
  },
  measureValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  measureUnit: {
    fontSize: 14,
    color: '#666',
    marginTop: -4,
  },
  measureLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  separator: {
    width: 1,
    height: 48,
    backgroundColor: '#e0e0e0',
  },
  noData: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  timestamp: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'right',
    marginTop: 8,
  },
});
