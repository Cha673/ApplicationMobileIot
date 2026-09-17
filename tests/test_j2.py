"""Tests d'intégration J2 : fraîcheur, doublons et mesures retardées.

Lancer avec :
    RUN_INTEGRATION=1 python -m pytest tests/test_j2.py -v
ou
    RUN_INTEGRATION=1 python tests/test_j2.py
"""
import json
import os
import time
import unittest
import uuid
import urllib.request

API_BASE = os.getenv('API_URL', 'http://localhost:3000')


def api_get(path: str):
    with urllib.request.urlopen(f'{API_BASE}{path}', timeout=10) as resp:
        return json.loads(resp.read())


@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite le kit Docker')
class J2Tests(unittest.TestCase):
    def setUp(self):
        from tools.mqtt_probe import Probe
        self.p = Probe()
        self.addCleanup(self.p.close)
        self.assertEqual(self.p.control('reset')['status'], 'ok')
        self.addCleanup(self.p.control, 'reset')
        self.base = 'campus/v1/devices/sensor-001/'

    def wait_sync(self):
        """Laisse le batch MongoDB→PostgreSQL tourner au moins une fois (5 s + marge)."""
        time.sleep(6)

    def _telemetry(self):
        return self.p.wait(
            lambda t, v, r: t == self.base + 'telemetry' and isinstance(v, dict)
        )[1]

    def _control_payload(self, payload: dict, device: str = 'sensor-001', timeout: int = 8) -> dict:
        """Envoie un contrôle avec paramètres supplémentaires non supportés par Probe.control()."""
        while not self.p.messages.empty():
            try:
                self.p.messages.get_nowait()
            except Exception:
                break
        request_id = uuid.uuid4().hex
        self.p.publish(
            f'campus/v1/simulator/{device}/control',
            {**payload, 'request_id': request_id},
        )
        return self.p.wait(
            lambda t, v, r: (
                t.endswith('/events')
                and isinstance(v, dict)
                and v.get('request_id') == request_id
            ),
            timeout=timeout,
        )[1]

    def test_duplicate_measure_does_not_create_extra_entry(self):
        """Milestone J2-1 : une mesure rejouée ne crée pas de doublon métier."""
        # Attendre une mesure fraîche, puis figer le simulateur
        self._telemetry()
        self.p.control('pause')
        self.wait_sync()

        before = api_get('/api/rooms/salle-203/history')
        ids_before = {m['messageId'] for m in before}

        # Rejouer deux fois le même message_id
        self.p.control('duplicate')
        self.p.control('duplicate')
        self.wait_sync()

        after = api_get('/api/rooms/salle-203/history')
        ids_after = {m['messageId'] for m in after}

        self.assertEqual(
            ids_before,
            ids_after,
            'un duplicat a été inséré dans l\'historique',
        )

    def test_delayed_measure_does_not_replace_current_state(self):
        """Milestone J2-2 : une mesure ancienne ne remplace pas silencieusement l'état courant."""
        # Attendre une mesure fraîche, puis figer
        self._telemetry()
        self.p.control('pause')
        self.wait_sync()

        room = api_get('/api/rooms/salle-203')
        current_latest = room['latestMeasurement']['observedAt']
        current_temperature = room['latestMeasurement']['temperature']
        current_co2 = room['latestMeasurement']['co2']

        # Injecter une mesure avec observed_at = 60 s dans le passé (nouveau message_id)
        self.p.control('delay')
        self.wait_sync()

        room_after = api_get('/api/rooms/salle-203')
        latest_after = room_after['latestMeasurement']['observedAt']

        self.assertGreaterEqual(
            latest_after,
            current_latest,
            'la mesure retardée a écrasé l\'état courant',
        )
        self.assertEqual(room_after['latestMeasurement']['temperature'], current_temperature)
        self.assertEqual(room_after['latestMeasurement']['co2'], current_co2)

    def test_paused_sensor_becomes_stale(self):
        """Jalon J3 : le silence télémétrique est distinct de la disponibilité MQTT."""
        self._telemetry()
        self.p.control('pause')
        time.sleep(11)

        room = api_get('/api/rooms/salle-203')
        self.assertTrue(room['isOnline'], 'la disponibilité MQTT ne devrait pas changer sur pause')
        self.assertTrue(room['isStale'], 'un capteur silencieux doit être marqué stale')
        self.assertIsNotNone(room['lastTelemetryAt'])

    def test_volume_history_contains_no_business_duplicate(self):
        """Milestone J2 : un volume de mesures avec doublons ne corrompt pas l'historique."""
        self.p.control('pause')
        self.wait_sync()

        # Envoyer 20 mesures uniques + 5 doublons
        result = self._control_payload({
            'action': 'volume',
            'count': 20,
            'duplicates': 5,
        })
        self.assertEqual(result['status'], 'ok', f'volume rejeté : {result}')
        self.wait_sync()

        history = api_get('/api/rooms/salle-203/history')
        ids = [m['messageId'] for m in history]
        self.assertEqual(
            len(ids),
            len(set(ids)),
            'doublon métier détecté dans l\'historique après volume',
        )

    def test_stress_volume_no_duplicate_and_ordered(self):
        """Stress J2 : 1000 mesures + 250 doublons — déduplication et ordre tenus sous charge."""
        self.p.control('pause')
        self.wait_sync()

        result = self._control_payload({
            'action': 'volume',
            'count': 1000,
            'duplicates': 250,
        }, timeout=60)
        self.assertEqual(result['status'], 'ok', f'volume rejeté : {result}')

        # BATCH_SIZE=500, SYNC_INTERVAL=5 s → 1000 msgs need ≥2 cycles; wait 15 s with margin
        time.sleep(15)

        history = api_get('/api/rooms/salle-203/history')
        ids = [m['messageId'] for m in history]
        self.assertEqual(len(ids), len(set(ids)), 'doublon détecté dans l\'historique sous charge')

        if len(history) >= 2:
            timestamps = [m['observedAt'] for m in history]
            self.assertEqual(
                timestamps,
                sorted(timestamps, reverse=True),
                'ordre observedAt DESC rompu sous charge',
            )

    def test_history_always_ordered_newest_first(self):
        """Invariant J2 : l'historique est trié observedAt DESC (mesure retardée en queue)."""
        history = api_get('/api/rooms/salle-203/history')
        if len(history) < 2:
            self.skipTest('historique insuffisant pour vérifier l\'ordre')
        timestamps = [m['observedAt'] for m in history]
        self.assertEqual(
            timestamps,
            sorted(timestamps, reverse=True),
            'l\'historique n\'est pas trié du plus récent au plus ancien',
        )


if __name__ == '__main__':
    unittest.main()
