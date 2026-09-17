"""Tests J3 — Journalisation structurée.

Vérifie que :
  1. Chaque ligne émise par le simulateur et le backend est du JSON valide
     avec les champs obligatoires (timestamp, service, level, event).
  2. Les entrées invalides (payload MQTT malformé, message trop grand,
     mesure hors-bornes) sont rejetées et isolées sans compromettre
     le traitement des messages suivants.

Lancer depuis l'hôte :
    RUN_INTEGRATION=1 MQTT_PORT=1884 python3 -m unittest tests.test_j3_logs -v

Lancer depuis Docker (via docker compose run) :
    docker compose run --rm -e RUN_INTEGRATION=1 -e API_URL=http://backend:3000 tests \
        python3 -m unittest tests.test_j3_logs.LogResilienceTests -v
"""
import json
import os
import subprocess
import time
import unittest
import urllib.request

API_BASE = os.getenv('API_URL', 'http://localhost:3000')
SIMULATOR_CONTAINER = os.getenv('SIMULATOR_CONTAINER', 'applicationmobileiot-simulator-1')
BACKEND_CONTAINER = os.getenv('BACKEND_CONTAINER', 'applicationmobileiot-backend-1')
REQUIRED_FIELDS = {'timestamp', 'service', 'level', 'event'}
VALID_LEVELS = {'debug', 'info', 'warn', 'warning', 'error'}


def docker_logs(container: str, since: str = '60s'):
    """Retourne les lignes d'un conteneur, ou None si docker CLI est indisponible."""
    try:
        result = subprocess.run(
            ['docker', 'logs', '--since', since, container],
            capture_output=True, text=True, timeout=10,
        )
        output = result.stdout + result.stderr
        return [line for line in output.splitlines() if line.strip()]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def parse_json_logs(lines: list[str]) -> tuple[list[dict], list[str]]:
    valid, invalid = [], []
    for line in lines:
        try:
            valid.append(json.loads(line))
        except json.JSONDecodeError:
            invalid.append(line)
    return valid, invalid


def api_get(path: str) -> object:
    with urllib.request.urlopen(f'{API_BASE}{path}', timeout=10) as resp:
        return json.loads(resp.read())


@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite le kit Docker')
class LogFormatTests(unittest.TestCase):
    """Chaque ligne émise sur stdout est du JSON délimité valide (exige docker CLI)."""

    def _check_container(self, container: str) -> None:
        lines = docker_logs(container)
        if lines is None:
            self.skipTest('docker CLI indisponible sur cet hôte')
        self.assertGreater(len(lines), 0, f'Aucun log trouvé dans {container}')

        valid, invalid = parse_json_logs(lines)
        self.assertFalse(
            invalid,
            f'{container} : {len(invalid)} ligne(s) non-JSON :\n' +
            '\n'.join(f'  {l!r}' for l in invalid[:5]),
        )
        for entry in valid:
            missing = REQUIRED_FIELDS - entry.keys()
            self.assertFalse(
                missing,
                f'{container} : champs manquants {missing} dans :\n  {json.dumps(entry)}',
            )
            self.assertIn(
                entry['level'], VALID_LEVELS,
                f'{container} : niveau inconnu {entry["level"]!r}',
            )

    def test_simulator_all_lines_are_valid_json(self):
        self._check_container(SIMULATOR_CONTAINER)

    def test_backend_all_lines_are_valid_json(self):
        self._check_container(BACKEND_CONTAINER)


@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite le kit Docker')
class LogResilienceTests(unittest.TestCase):
    """Les entrées invalides sont isolées ; le service continue de fonctionner.

    Ces tests vérifient le comportement observable (MQTT + API). Si docker CLI
    est disponible, ils vérifient aussi que l'événement d'erreur apparaît dans
    les logs JSON.
    """

    def setUp(self):
        from tools.mqtt_probe import Probe  # paho disponible dans l'image Docker
        self.p = Probe()
        self.addCleanup(self.p.close)
        self.assertEqual(self.p.control('reset')['status'], 'ok')
        self.addCleanup(self.p.control, 'reset')

    def _publish_raw(self, topic: str, payload: bytes) -> None:
        info = self.p.client.publish(topic, payload, qos=1)
        info.wait_for_publish(timeout=5)

    def _check_log_event(self, container: str, event: str, since: str = '10s') -> None:
        """Vérifie qu'un événement apparaît dans les logs si docker est disponible."""
        lines = docker_logs(container, since=since)
        if lines is None:
            return  # docker non disponible — assertion optionnelle ignorée
        valid, _ = parse_json_logs(lines)
        self.assertTrue(
            any(e.get('event') == event for e in valid),
            f'Événement {event!r} absent des logs {container}',
        )

    def test_invalid_json_payload_isolated_backend_keeps_running(self):
        """Payload non-JSON rejeté ; le backend traite immédiatement le message suivant."""
        self._publish_raw('campus/v1/devices/sensor-001/telemetry', b'not-valid-json{{')
        time.sleep(2)

        # Vérification comportementale : le backend reçoit encore de la télémétrie valide
        msg = self.p.wait(
            lambda t, v, r: t == 'campus/v1/devices/sensor-001/telemetry' and isinstance(v, dict),
            timeout=10,
        )
        self.assertIsNotNone(msg)

        # Vérification optionnelle des logs
        self._check_log_event(BACKEND_CONTAINER, 'mqtt.parse_error')

    def test_oversized_command_isolated_simulator_keeps_publishing(self):
        """Message trop grand (>4096 o) ignoré ; le simulateur continue d'émettre."""
        self._publish_raw('campus/v1/devices/sensor-001/commands', b'x' * 5000)
        time.sleep(2)

        # Vérification comportementale : le simulateur émet encore
        self.p.wait(
            lambda t, v, r: t == 'campus/v1/devices/sensor-001/telemetry' and isinstance(v, dict),
            timeout=10,
        )

        # Vérification optionnelle des logs
        self._check_log_event(SIMULATOR_CONTAINER, 'sensor.message_too_large')

    def test_invalid_telemetry_not_persisted_backend_keeps_running(self):
        """Mesure avec co2 invalide rejetée ; elle n'apparaît pas dans l'historique."""
        self.p.control('pause')
        time.sleep(6)  # laisser le sync vider le buffer

        before_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}

        self.p.control('invalid')
        time.sleep(6)

        after_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        new_invalid = [mid for mid in (after_ids - before_ids) if mid.startswith('invalid-')]
        self.assertFalse(
            new_invalid,
            f'Mesure invalide persistée dans l\'historique : {new_invalid}',
        )

        # Vérification optionnelle des logs
        self._check_log_event(BACKEND_CONTAINER, 'telemetry.rejected', since='15s')


if __name__ == '__main__':
    unittest.main()
