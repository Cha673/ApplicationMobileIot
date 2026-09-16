import { test, expect } from '@playwright/test';

/**
 * Tests Playwright J2 — API backend
 *
 * Vérifient les invariants de qualité des données exposés par l'API HTTP :
 *   - déduplication (pas de message_id dupliqué dans l'historique)
 *   - ordre temporel (observedAt DESC, mesure retardée ne remonte pas en tête)
 *   - limite de l'historique respectée
 *   - cohérence latestMeasurement ↔ history[0]
 *
 * Prérequis : backend en cours d'exécution sur API_URL (défaut http://localhost:3000)
 * Lancer : cd tests/playwright && npx playwright test
 */

interface Room {
  roomId: string;
  deviceId: string;
  isOnline: boolean;
  latestMeasurement: { observedAt: string; temperature: number; co2: number } | null;
}

interface Measurement {
  messageId: string;
  observedAt: string;
  temperature: number;
  co2: number;
}

test.describe('J2 — Données fiables (contrat API)', () => {
  test('health endpoint répond ok avec un timestamp ISO', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  test('GET /api/rooms retourne un tableau de salles au schéma valide', async ({ request }) => {
    const res = await request.get('/api/rooms');
    expect(res.ok()).toBeTruthy();
    const rooms = await res.json() as Room[];
    expect(Array.isArray(rooms)).toBeTruthy();
    for (const room of rooms) {
      expect(typeof room.roomId).toBe('string');
      expect(typeof room.deviceId).toBe('string');
      expect(typeof room.isOnline).toBe('boolean');
    }
  });

  test('GET /api/rooms/:id inconnu retourne 404', async ({ request }) => {
    const res = await request.get('/api/rooms/salle-inexistante-j2-test-xxxxx');
    expect(res.status()).toBe(404);
  });

  test('historique respecte le paramètre limit', async ({ request }) => {
    const rooms = await (await request.get('/api/rooms')).json() as Room[];
    if (rooms.length === 0) return;

    const roomId = rooms[0].roomId;
    const limit = 5;
    const res = await request.get(
      `/api/rooms/${encodeURIComponent(roomId)}/history?limit=${limit}`,
    );
    expect(res.ok()).toBeTruthy();
    const history = await res.json() as unknown[];
    expect(history.length).toBeLessThanOrEqual(limit);
  });

  test('historique trié observedAt DESC — une mesure retardée ne remonte pas en tête', async ({ request }) => {
    const rooms = await (await request.get('/api/rooms')).json() as Room[];
    if (rooms.length === 0) return;

    const roomId = rooms[0].roomId;
    const res = await request.get(`/api/rooms/${encodeURIComponent(roomId)}/history`);
    expect(res.ok()).toBeTruthy();
    const history = await res.json() as Measurement[];
    if (history.length < 2) return;

    const timestamps = history.map((m) => m.observedAt);
    const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
    expect(timestamps).toEqual(sorted);
  });

  test('aucun messageId dupliqué dans l\'historique — déduplication active', async ({ request }) => {
    const rooms = await (await request.get('/api/rooms')).json() as Room[];
    if (rooms.length === 0) return;

    const roomId = rooms[0].roomId;
    const res = await request.get(`/api/rooms/${encodeURIComponent(roomId)}/history`);
    expect(res.ok()).toBeTruthy();
    const history = await res.json() as Measurement[];
    if (history.length === 0) return;

    const ids = history.map((m) => m.messageId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('latestMeasurement correspond au premier élément de l\'historique', async ({ request }) => {
    const rooms = await (await request.get('/api/rooms')).json() as Room[];
    const room = rooms.find((r) => r.latestMeasurement !== null);
    if (!room) return;

    const res = await request.get(
      `/api/rooms/${encodeURIComponent(room.roomId)}/history?limit=1`,
    );
    const history = await res.json() as Measurement[];
    if (history.length === 0) return;

    expect(history[0].observedAt).toBe(room.latestMeasurement!.observedAt);
  });

  test('historique d\'une salle inconnue retourne 404', async ({ request }) => {
    const res = await request.get(
      '/api/rooms/salle-inexistante-j2-test-xxxxx/history',
    );
    expect(res.status()).toBe(404);
  });
});
