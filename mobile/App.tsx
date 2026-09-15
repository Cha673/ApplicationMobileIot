import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { RoomsScreen } from './src/screens/RoomsScreen';
import { RoomDetailScreen } from './src/screens/RoomDetailScreen';
import type { Room } from './src/api';

export default function App(): React.ReactElement {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  return (
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
