import { create } from 'zustand';
import type { Room } from '../api';

interface AppState {
  selectedRoom: Room | null;
  selectRoom: (room: Room) => void;
  clearRoom: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedRoom: null,
  selectRoom: (room) => set({ selectedRoom: room }),
  clearRoom: () => set({ selectedRoom: null }),
}));
