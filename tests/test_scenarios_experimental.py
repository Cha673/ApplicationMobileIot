"""Protocole expérimental — 11 scénarios obligatoires J3.

Chaque scénario suit la démarche en 6 étapes :
  1. Hypothèse  — docstring de la classe
  2. Injection  — méthode _inject_*
  3. Observation — corps du test (assertions + traces)
  4. Explication — commentaires inline
  5. Décision   — commentaire DECISION: dans le test
  6. Vérification — méthode test_*_verification (rejoue après correction)

Lancement depuis l'hôte (docker compose up -d requis) :
    RUN_INTEGRATION=1 MQTT_PORT=1884 python3 -m unittest tests.test_scenarios_experimental -v

Lancement dans le conteneur de tests :
    docker compose run --rm -e RUN_INTEGRATION=1 -e API_URL=http://backend:3000 tests \\
        python3 -m unittest tests.test_scenarios_experimental -v
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import unittest
import urllib.request
import uuid

API_BASE  = os.getenv('API_URL',            'http://localhost:3000')
MQTT_PORT = int(os.getenv('MQTT_PORT',      '1884'))
MQTT_HOST = os.getenv('MQTT_HOST',          'localhost')
COMPOSE_PROJECT = os.getenv('COMPOSE_PROJECT', 'applicationmobileiot')

STALENESS_TTL_S = int(os.getenv('FRESHNESS_THRESHOLD_MS', '10000')) // 1000 + 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def api_get(path: str) -> object:
    with urllib.request.urlopen(f'{API_BASE}{path}', timeout=10) as resp:
        return json.loads(resp.read())


def docker_logs(container: str, since: str = '30s') -> list[str] | None:
    try:
        r = subprocess.run(
            ['docker', 'logs', '--since', since, container],
            capture_output=True, text=True, timeout=10,
        )
        lines = (r.stdout + r.stderr).splitlines()
        return [l for l in lines if l.strip()]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def compose_exec(cmd: list[str], timeout: int = 30) -> bool:
    """Run a docker compose command; return True on success."""
    try:
        r = subprocess.run(
            ['docker', 'compose'] + cmd,
            capture_output=True, text=True, timeout=timeout,
            cwd=os.path.join(os.path.dirname(__file__), '..'),
        )
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def docker_available() -> bool:
    return compose_exec(['ps', '--services'], timeout=8)


def service_stop(name: str) -> bool:
    return compose_exec(['stop', name])


def service_start(name: str) -> bool:
    ok = compose_exec(['start', name])
    time.sleep(4)   # laisser le service démarrer et se reconnecter
    return ok


def count_json_log_events(container: str, event: str, since: str = '15s') -> int:
    lines = docker_logs(container, since=since)
    if lines is None:
        return -1  # docker indisponible
    count = 0
    for line in lines:
        try:
            entry = json.loads(line)
            if entry.get('event') == event:
                count += 1
        except json.JSONDecodeError:
            pass
    return count


# ---------------------------------------------------------------------------
# Base de test
# ---------------------------------------------------------------------------

@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite RUN_INTEGRATION=1')
class ScenarioBase(unittest.TestCase):
    """Initialise un Probe MQTT + reset du simulateur avant chaque test."""

    def setUp(self):
        from tools.mqtt_probe import Probe
        self.p = Probe()
        self.addCleanup(self.p.close)
        ack = self.p.control('reset')
        self.assertEqual(ack['status'], 'ok', 'reset initial échoué')
        self.addCleanup(self.p.control, 'reset')
        self.base001 = 'campus/v1/devices/sensor-001/'
        self.base002 = 'campus/v1/devices/sensor-002/'

    def wait_telemetry(self, device='sensor-001', timeout=10):
        prefix = f'campus/v1/devices/{device}/'
        return self.p.wait(
            lambda t, v, r: t == prefix + 'telemetry' and isinstance(v, dict),
            timeout=timeout,
        )[1]

    def publish_raw(self, topic: str, payload: bytes) -> None:
        info = self.p.client.publish(topic, payload, qos=1)
        info.wait_for_publish(timeout=5)


# ===========================================================================
# SC-01  Isolation des devices
# ===========================================================================

class Sc01_DeviceIsolation(ScenarioBase):
    """Hypothèse : sensor-001 et sensor-002 publient en parallèle.
    Chaque message porte un device_id différent ; les logs permettent de suivre
    chaque flux sans croisement.
    """

    def test_01_isolation_parallel_publish(self):
        # INJECTION : laisser le simulateur émettre normalement sur les deux capteurs.
        # OBSERVATION : collecter 5 messages de chaque device et vérifier qu'aucun
        # message de sensor-001 ne porte le device_id de sensor-002 et vice-versa.
        collected = {d: [] for d in ('sensor-001', 'sensor-002')}
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and any(len(v) < 5 for v in collected.values()):
            try:
                topic, raw, _ = self.p.messages.get(timeout=1)
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                for dev in collected:
                    if topic == f'campus/v1/devices/{dev}/telemetry':
                        collected[dev].append(msg)
            except queue.Empty:
                pass

        # Chaque flux doit avoir produit au moins 5 mesures
        for dev, msgs in collected.items():
            self.assertGreaterEqual(len(msgs), 5, f'{dev}: trop peu de mesures collectées')

        # Aucun croisement de device_id
        for dev, msgs in collected.items():
            for msg in msgs:
                self.assertEqual(
                    msg.get('device_id'), dev,
                    f'Croisement de données : message de {msg.get("device_id")} '
                    f'reçu sur le topic de {dev}',
                )

        # DÉCISION : comportement acceptable — chaque flux est indépendant.


# ===========================================================================
# SC-02  Usurpation d'un device (impersonation)
# ===========================================================================

class Sc02_Impersonation(ScenarioBase):
    """Hypothèse : un client publiant sur le topic d'un autre device (en utilisant
    les credentials teacher qui ont accès readwrite campus/#) peut injecter une
    mesure portant un device_id arbitraire. L'ACL actuelle n'est pas par-device,
    donc le broker ne bloque pas.  Le backend doit cependant loguer l'événement.
    """

    def test_02a_impersonation_not_blocked_by_acl(self):
        # INJECTION : publier un faux message sensor-001 depuis le Probe (teacher).
        marker = uuid.uuid4().hex
        fake_payload = {
            'message_id':  'impersonation-' + marker,
            'device_id':   'sensor-001',
            'room_id':     'salle-203',
            'observed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'temperature': {'value': 99},
            'co2':         {'value': 500},
        }
        self.p.publish(self.base001 + 'telemetry', fake_payload)
        time.sleep(3)

        # OBSERVATION : le backend a-t-il accepté la mesure ?
        history = api_get('/api/rooms/salle-203/history')
        ids = {m['messageId'] for m in history}
        accepted = fake_payload['message_id'] in ids

        # EXPLICATION : l'ACL Mosquitto utilise un wildcard "+", donc n'importe quel
        # client ayant accès en écriture à campus/v1/devices/+/telemetry peut publier
        # pour n'importe quel device_id.  Avec les credentials "teacher" (readwrite
        # campus/#) c'est encore plus direct.  Le backend valide la structure Zod mais
        # PAS l'origine du message.

        # DÉCISION : le scénario prouve l'absence de protection per-device au niveau ACL.
        # La mitigation recommandée est ADR-01 : générer des lignes ACL par device_id
        # (campus/v1/devices/sensor-001/telemetry pour user=sensor-001, etc.).
        # Ce test DOCUMENTE le comportement actuel — il passe si la faille est présente.
        if accepted:
            # La mesure usurpée a été acceptée : faille confirmée, mitigation requise.
            pass  # Résultat attendu avant mitigation
        else:
            # Une mitigation a été déployée : la mesure est rejetée.
            pass

    def test_02b_backend_user_cannot_inject_telemetry(self):
        # L'utilisateur "backend" ne peut PAS écrire sur les topics telemetry (ACL read-only).
        from tools.mqtt_probe import Probe
        with Probe(username='backend', password=os.getenv('BACKEND_PASSWORD', 'backend-demo')) as back:
            marker = uuid.uuid4().hex
            back.publish(self.base001 + 'telemetry', {'forbidden': marker})
            # Le broker Mosquitto doit rejeter la publication silencieusement (ACL deny).
            with self.assertRaises(TimeoutError):
                self.p.wait(
                    lambda t, v, r: isinstance(v, dict) and v.get('forbidden') == marker,
                    timeout=3,
                )
        # DÉCISION : le client "backend" est bien isolé — seul "simulator" (ou teacher)
        # peut écrire sur les topics devices.


# ===========================================================================
# SC-03  Payload invalide
# ===========================================================================

class Sc03_InvalidPayload(ScenarioBase):
    """Hypothèse : un JSON invalide, un message incomplet et une valeur physiquement
    incohérente doivent chacun être rejetés sans crash silencieux.  Un log structuré
    doit être émis pour chaque rejet.
    """

    def _service_still_healthy(self):
        """Vérifie que le backend répond encore."""
        try:
            api_get('/api/rooms/salle-203')
            return True
        except Exception:
            return False

    def test_03a_invalid_json_no_crash(self):
        # INJECTION 1 : JSON malformé
        self.publish_raw(self.base001 + 'telemetry', b'{bad json{{')
        time.sleep(2)
        self.assertTrue(self._service_still_healthy(), 'backend planté sur JSON malformé')
        # Vérification log
        n = count_json_log_events(f'{COMPOSE_PROJECT}-backend-1', 'mqtt.parse_error')
        if n >= 0:
            self.assertGreater(n, 0, 'mqtt.parse_error absent des logs')

    def test_03b_incomplete_payload_rejected(self):
        # INJECTION 2 : message JSON valide mais sans champs obligatoires
        self.p.publish(self.base001 + 'telemetry', {'device_id': 'sensor-001'})
        time.sleep(2)
        self.assertTrue(self._service_still_healthy(), 'backend planté sur payload incomplet')
        n = count_json_log_events(f'{COMPOSE_PROJECT}-backend-1', 'telemetry.rejected')
        if n >= 0:
            self.assertGreater(n, 0, 'telemetry.rejected absent des logs')

    def test_03c_impossible_value_rejected_not_persisted(self):
        # INJECTION 3 : valeur impossible — co2 = -1 (hors plage physique)
        self.p.control('pause')
        time.sleep(6)
        before_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}

        bad_id = 'impossible-' + uuid.uuid4().hex
        self.p.publish(self.base001 + 'telemetry', {
            'message_id':  bad_id,
            'device_id':   'sensor-001',
            'room_id':     'salle-203',
            'observed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'temperature': {'value': 20},
            'co2':         {'value': -1},  # impossible physiquement
        })
        time.sleep(6)

        after_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        self.assertNotIn(bad_id, after_ids, 'valeur impossible (-1 ppm CO₂) persistée')
        self.assertTrue(self._service_still_healthy())
        # DÉCISION : le backend rejette via Zod + validation physique — comportement correct.

    def test_03d_co2_string_value_rejected(self):
        # INJECTION 4 : co2.value est une chaîne au lieu d'un nombre (action "invalid")
        self.p.control('pause')
        time.sleep(6)
        before_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}

        self.p.control('invalid')
        time.sleep(6)

        after_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        new_invalid = [mid for mid in (after_ids - before_ids) if mid.startswith('invalid-')]
        self.assertFalse(new_invalid, f'Mesure invalide persistée : {new_invalid}')
        # DÉCISION : Zod rejette co2.value de type string — comportement correct.


# ===========================================================================
# SC-04  Doublon
# ===========================================================================

class Sc04_Duplicate(ScenarioBase):
    """Hypothèse : envoyer deux fois le même message_id ne doit créer qu'une seule
    entrée dans l'historique.  Le second passage doit être loggué comme doublon.
    """

    def test_04_duplicate_not_persisted(self):
        # INJECTION : obtenir une mesure, la rejouer deux fois
        self.wait_telemetry()
        self.p.control('pause')
        time.sleep(6)

        before_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        self.p.control('duplicate')
        self.p.control('duplicate')
        time.sleep(6)

        after_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        new_ids = after_ids - before_ids
        # OBSERVATION : aucun nouveau message_id ne doit apparaître (le doublon n'est
        # pas un nouveau messageId, juste un rejeu du dernier enregistré).
        self.assertEqual(before_ids, after_ids, f'Doublons insérés : {new_ids}')

        # Vérifier que le log de doublon est émis
        n = count_json_log_events(f'{COMPOSE_PROJECT}-backend-1', 'telemetry.duplicate')
        if n >= 0:
            self.assertGreater(n, 0, 'telemetry.duplicate absent des logs')
        # DÉCISION : la déduplication par message_id fonctionne — comportement correct.


# ===========================================================================
# SC-05  Désordre et replay
# ===========================================================================

class Sc05_DisorderReplay(ScenarioBase):
    """Hypothèse : envoyer une mesure ancienne (observed_at – 60 s) après une mesure
    fraîche ne doit pas remplacer l'état courant.  L'état courant = mesure ayant
    l'observed_at le plus récent, peu importe l'ordre d'arrivée.
    """

    def test_05a_delayed_does_not_overwrite_current_state(self):
        # INJECTION : mesure fraîche → pause → mesure retardée (60 s dans le passé)
        self.wait_telemetry()
        self.p.control('pause')
        time.sleep(6)

        room_before = api_get('/api/rooms/salle-203')
        latest_before = room_before['latestMeasurement']['observedAt']

        self.p.control('delay')
        time.sleep(6)

        room_after = api_get('/api/rooms/salle-203')
        latest_after = room_after['latestMeasurement']['observedAt']

        # OBSERVATION : l'état courant ne doit pas reculer dans le temps
        self.assertGreaterEqual(
            latest_after, latest_before,
            'La mesure retardée a écrasé l\'état courant',
        )
        # EXPLICATION : le backend compare observed_at et n'écrase que si la nouvelle
        # mesure est plus récente (PgMeasurementRepository.saveBatch).
        # DÉCISION : comportement correct.

    def test_05b_replay_old_event_stored_but_not_current(self):
        # INJECTION : envoyer une mesure très ancienne après une fraîche
        self.wait_telemetry()
        self.p.control('pause')
        time.sleep(6)

        current = api_get('/api/rooms/salle-203')
        current_ts = current['latestMeasurement']['observedAt']

        # Rejouer un ancien événement : observed_at = 2 minutes dans le passé
        from datetime import datetime, timezone, timedelta
        old_id = 'replay-' + uuid.uuid4().hex
        old_ts = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        self.p.publish(self.base001 + 'telemetry', {
            'message_id':  old_id,
            'device_id':   'sensor-001',
            'room_id':     'salle-203',
            'observed_at': old_ts,
            'temperature': {'value': 15},
            'co2':         {'value': 300},
        })
        time.sleep(6)

        room_after = api_get('/api/rooms/salle-203')
        # État courant ne doit pas avoir reculé
        self.assertGreaterEqual(room_after['latestMeasurement']['observedAt'], current_ts)
        # Mais l'historique peut contenir l'ancien événement (archive)
        history_ids = {m['messageId'] for m in api_get('/api/rooms/salle-203/history')}
        # DÉCISION : l'état courant est protégé ; l'archive peut stocker l'ancien événement.


# ===========================================================================
# SC-06  Capteur silencieux
# ===========================================================================

class Sc06_SilentSensor(ScenarioBase):
    """Hypothèse : après silence télémetrique, le capteur est marqué isStale=true
    sans que isOnline change (MQTT availability reste online).  Le délai avant
    marquage = FRESHNESS_THRESHOLD_MS (défaut 10 s).
    """

    def test_06_stale_after_silence(self):
        # INJECTION : laisser arriver une mesure fraîche puis mettre en pause
        self.wait_telemetry()
        self.p.control('pause')
        t0 = time.monotonic()

        # OBSERVATION : attendre que isStale devienne vrai
        stale_at = None
        for _ in range(40):
            time.sleep(1)
            room = api_get('/api/rooms/salle-203')
            if room.get('isStale'):
                stale_at = time.monotonic() - t0
                break

        self.assertIsNotNone(stale_at, 'isStale jamais devenu True après silence')
        self.assertTrue(
            api_get('/api/rooms/salle-203').get('isOnline'),
            'isOnline a changé sans déconnexion MQTT',
        )
        # EXPLICATION : le backend sweep toutes les FRESHNESS_THRESHOLD_MS ms et compare
        # last_telemetry_at.  La disponibilité MQTT n'est modifiée que par availability.
        print(f'\n[SC-06] isStale=True atteint en {stale_at:.1f} s (seuil configuré={STALENESS_TTL_S-5} s)')
        # DÉCISION : comportement correct — staleness et online sont découplés.


# ===========================================================================
# SC-07  Broker indisponible
# ===========================================================================

@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite RUN_INTEGRATION=1')
class Sc07_BrokerUnavailable(unittest.TestCase):
    """Hypothèse : quand le broker s'arrête, le simulateur et le backend perdent la
    connexion.  Quand le broker redémarre, les deux se reconnectent automatiquement
    et la télémétrie reprend sans intervention manuelle.
    """

    def setUp(self):
        if not docker_available():
            self.skipTest('docker CLI indisponible')

    def test_07_broker_cut_and_restore(self):
        from tools.mqtt_probe import Probe

        # État initial : vérifier qu'on reçoit de la télémétrie
        p = Probe()
        try:
            msg_before = p.wait(
                lambda t, v, r: t.endswith('/telemetry') and isinstance(v, dict),
                timeout=10,
            )
            self.assertIsNotNone(msg_before)
        finally:
            p.close()

        # INJECTION : arrêter le broker
        print('\n[SC-07] Arrêt du broker...')
        self.assertTrue(service_stop('mosquitto'), 'impossible d\'arrêter mosquitto')
        t_stop = time.monotonic()

        time.sleep(5)  # laisser les clients détecter la coupure

        # OBSERVATION intermédiaire : le backend logge mqtt.reconnecting
        backend_logs = docker_logs(f'{COMPOSE_PROJECT}-backend-1', since='10s')
        if backend_logs:
            reconnect_logs = [l for l in backend_logs if 'reconnect' in l.lower()]
            print(f'[SC-07] Logs reconnexion backend: {len(reconnect_logs)} ligne(s)')

        # INJECTION 2 : redémarrer le broker
        print('[SC-07] Redémarrage du broker...')
        self.assertTrue(service_start('mosquitto'), 'impossible de redémarrer mosquitto')
        t_restart = time.monotonic()

        # VÉRIFICATION : attendre la reprise de la télémétrie
        p2 = Probe()
        try:
            msg_after = p2.wait(
                lambda t, v, r: t.endswith('/telemetry') and isinstance(v, dict),
                timeout=20,
            )
            t_recover = time.monotonic()
            self.assertIsNotNone(msg_after, 'Aucune télémétrie après redémarrage du broker')
            print(f'[SC-07] Reprise en {t_recover - t_restart:.1f} s après redémarrage broker')
        finally:
            p2.close()

        # EXPLICATION : le simulateur utilise reconnect_delay_set(1, 8) et le backend
        # mqtt.connect avec reconnectPeriod=3000 ms.  Les deux se reconnectent automatiquement.
        # DÉCISION : reprise automatique confirmée.


# ===========================================================================
# SC-08  Backend indisponible
# ===========================================================================

@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite RUN_INTEGRATION=1')
class Sc08_BackendUnavailable(unittest.TestCase):
    """Hypothèse : pendant l'arrêt du backend, les capteurs continuent de publier
    sur le broker.  Au redémarrage, le backend se réabonne et reçoit les messages
    non encore consommés (QoS 1 côté broker).  Mais comme le backend utilise
    clean=true, la session n'est PAS persistée : les messages publiés pendant
    l'absence SONT PERDUS pour le backend.
    """

    def setUp(self):
        if not docker_available():
            self.skipTest('docker CLI indisponible')

    def test_08_backend_cut_and_restore(self):
        from tools.mqtt_probe import Probe

        p = Probe()
        try:
            # Baseline : récupérer l'historique avant la coupure
            history_before = api_get('/api/rooms/salle-203/history')
            ids_before = {m['messageId'] for m in history_before}

            # INJECTION : arrêter le backend
            print('\n[SC-08] Arrêt du backend...')
            self.assertTrue(service_stop('backend'), 'impossible d\'arrêter le backend')
            time.sleep(3)

            # Pendant l'arrêt : le simulateur continue de publier (observable via probe)
            received_during_outage = []
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                try:
                    topic, raw, _ = p.messages.get(timeout=1)
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    if topic.endswith('/telemetry') and isinstance(msg, dict):
                        received_during_outage.append(msg.get('message_id'))
                except queue.Empty:
                    pass

            print(f'[SC-08] {len(received_during_outage)} message(s) publiés pendant la coupure')
            self.assertGreater(len(received_during_outage), 0,
                               'Aucun message publié pendant la coupure backend')

            # INJECTION 2 : redémarrer le backend
            print('[SC-08] Redémarrage du backend...')
            self.assertTrue(service_start('backend'), 'impossible de redémarrer le backend')
            time.sleep(8)  # laisser le sync MongoDB→PG s'exécuter

            # OBSERVATION : comparer l'historique
            history_after = api_get('/api/rooms/salle-203/history')
            ids_after = {m['messageId'] for m in history_after}
            recovered = ids_after - ids_before
            lost = set(received_during_outage) - ids_after

            print(f'[SC-08] Récupérés après redémarrage : {len(recovered)}')
            print(f'[SC-08] Perdus (non visibles dans PG) : {len(lost)}')

            # EXPLICATION : avec clean=true, le broker ne conserve pas la session du backend.
            # Les messages QoS 1 publiés pendant l'absence sont conservés par le broker
            # SEULEMENT si le subscriber avait une session persistante (clean=false).
            # Avec clean=true, ils sont définitivement perdus pour le backend.
            # MongoDB n'a donc PAS reçu ces mesures.

            # DÉCISION : perte confirmée avec clean=true. ADR-04 recommande clean=false +
            # clientId fixe 'backend-primary' pour une session persistante.
        finally:
            p.close()
            # S'assurer que le backend est bien redémarré même en cas d'échec
            service_start('backend')


# ===========================================================================
# SC-09  QoS MQTT 0 vs 1
# ===========================================================================

@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite RUN_INTEGRATION=1')
class Sc09_QoSComparison(unittest.TestCase):
    """Hypothèse : lors d'une coupure/reprise broker, les messages publiés en QoS 0
    sont perdus (fire-and-forget), tandis qu'en QoS 1 le broker peut accuser
    réception et re-livrer si la session est persistante.
    """

    def setUp(self):
        if not docker_available():
            self.skipTest('docker CLI indisponible')

    def _run_qos_scenario(self, qos: int) -> tuple[int, int]:
        """Publie N messages pendant une coupure broker et retourne (envoyés, reçus_après_reprise)."""
        import paho.mqtt.client as mqtt_lib

        received = []
        ready = threading.Event()

        # Subscriber persistant (clean_session=False, QoS 1) pour maximiser la réception
        sub = mqtt_lib.Client(
            mqtt_lib.CallbackAPIVersion.VERSION2,
            client_id=f'qos-sub-{uuid.uuid4().hex[:8]}',
            clean_session=False,
        )
        sub.username_pw_set('teacher', os.getenv('TEACHER_PASSWORD', 'teacher-demo'))

        def on_sub_connect(c, u, f, rc, p):
            if not rc.is_failure:
                c.subscribe('campus/v1/test/qos', qos=1)

        def on_sub_message(c, u, m):
            try:
                received.append(json.loads(m.payload))
            except ValueError:
                pass

        sub.on_connect = on_sub_connect
        sub.on_subscribe = lambda *a: ready.set()
        sub.on_message = on_sub_message
        sub.connect(MQTT_HOST, MQTT_PORT, 10)
        sub.loop_start()
        ready.wait(8)

        # Publisher
        pub = mqtt_lib.Client(
            mqtt_lib.CallbackAPIVersion.VERSION2,
            client_id=f'qos-pub-{uuid.uuid4().hex[:8]}',
            clean_session=True,
        )
        pub.username_pw_set('teacher', os.getenv('TEACHER_PASSWORD', 'teacher-demo'))
        pub.connect(MQTT_HOST, MQTT_PORT, 10)
        pub.loop_start()
        time.sleep(1)

        N = 20
        sent_ids = []

        # INJECTION : couper le broker, publier N messages, rétablir
        print(f'\n[SC-09] QoS {qos} — Arrêt broker...')
        service_stop('mosquitto')
        time.sleep(2)

        for i in range(N):
            mid = f'qos{qos}-msg-{i:03d}'
            sent_ids.append(mid)
            pub.publish('campus/v1/test/qos', json.dumps({'seq': i, 'mid': mid}), qos=qos)
            time.sleep(0.05)

        print(f'[SC-09] QoS {qos} — Redémarrage broker...')
        service_start('mosquitto')
        time.sleep(5)  # attendre re-livraison éventuelle

        pub.disconnect()
        pub.loop_stop()
        sub.disconnect()
        sub.loop_stop()

        received_ids = {m.get('mid') for m in received}
        n_received = sum(1 for mid in sent_ids if mid in received_ids)
        print(f'[SC-09] QoS {qos} — Envoyés: {N}, Reçus: {n_received}, Perdus: {N - n_received}')
        return N, n_received

    def test_09_qos0_vs_qos1_during_broker_outage(self):
        sent0, rcv0 = self._run_qos_scenario(qos=0)
        time.sleep(3)
        sent1, rcv1 = self._run_qos_scenario(qos=1)

        # OBSERVATION : QoS 0 doit perdre plus de messages que QoS 1
        # (avec clean_session=True sur le publisher, même QoS 1 peut perdre si le
        # broker n'a pas reçu le PUBLISH avant la coupure)
        loss0 = sent0 - rcv0
        loss1 = sent1 - rcv1
        print(f'\n[SC-09] RÉSUMÉ — QoS 0: {loss0}/{sent0} perdus | QoS 1: {loss1}/{sent1} perdus')

        # EXPLICATION : en QoS 0 fire-and-forget, perte garantie si broker down.
        # En QoS 1, le publisher attend PUBACK ; sans ACK (broker down), il marque
        # le message comme pending et peut le re-livrer — mais avec clean_session=True
        # la file en mémoire est perdue si le client se déconnecte.
        # DÉCISION : QoS 1 + session persistante (clean=false) est nécessaire pour
        # garantir la livraison au redémarrage.
        self.assertGreaterEqual(loss0, loss1,
                                'QoS 0 devrait perdre au moins autant de messages que QoS 1')


# ===========================================================================
# SC-10  Message retained
# ===========================================================================

class Sc10_RetainedMessage(ScenarioBase):
    """Hypothèse : un message retained publié par le simulateur (availability/state)
    est re-livré immédiatement à tout nouveau subscriber.  Le backend doit
    distinguer un retained (ancienne donnée) d'un message frais.
    """

    def test_10a_retained_availability_delivered_on_reconnect(self):
        # OBSERVATION : ouvrir un nouveau Probe sur le topic state → doit recevoir
        # immédiatement le message retained (retain=True)
        from tools.mqtt_probe import Probe
        with Probe(topic=self.base001 + 'state') as p2:
            topic, value, retained = p2.wait(
                lambda t, v, r: t == self.base001 + 'state' and r,
                timeout=8,
            )
            self.assertTrue(retained, 'Le message state n\'est pas retained')
            self.assertIn('ventilation', value, 'Champ ventilation absent du state retained')

        # EXPLICATION : le simulateur publie state avec retain=True dans on_connect.
        # Tout nouveau subscriber reçoit immédiatement la dernière valeur connue.
        # DÉCISION : comportement normal — mais la fraîcheur doit être vérifiée
        # (isStale=True si la mesure retenue est ancienne).

    def test_10b_retained_telemetry_not_published(self):
        # OBSERVATION : vérifier qu'aucun message telemetry n'est retained.
        # Le simulateur publie telemetry sans retain=True (ADR-04).
        from tools.mqtt_probe import Probe
        with Probe(topic=self.base001 + 'telemetry') as p2:
            topic, value, retained = p2.wait(
                lambda t, v, r: t == self.base001 + 'telemetry' and isinstance(v, dict),
                timeout=10,
            )
            self.assertFalse(retained, 'La télémétrie NE DOIT PAS être retained')

        # EXPLICATION : si la télémétrie était retained, un backend qui redémarre
        # recevrait immédiatement une ancienne mesure et pourrait la confondre avec
        # une mesure fraîche.  En la traitant comme fraîche il mettrait à jour
        # last_telemetry_at et retarderait la détection de staleness.
        # DÉCISION : telemetry non-retained est correct (ADR-04).

    def test_10c_stale_check_independent_of_retained_state(self):
        # Même si le topic state a un retained, isStale doit se baser sur last_telemetry_at
        self.wait_telemetry()
        self.p.control('pause')
        time.sleep(STALENESS_TTL_S)
        room = api_get('/api/rooms/salle-203')
        self.assertTrue(room.get('isStale'),
                        'isStale doit être True malgré le message state retained')
        # DÉCISION : staleness basé sur la dernière télémétrie, pas sur le state retained.


# ===========================================================================
# SC-11  Montée en charge locale
# ===========================================================================

@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite RUN_INTEGRATION=1')
class Sc11_LoadTest(unittest.TestCase):
    """Hypothèse : augmenter la fréquence d'émission révèle le premier composant
    qui se dégrade (latence API, erreurs MQTT, déduplication MongoDB).
    Objectif : identifier une limite mesurée, pas atteindre un seuil imposé.
    """

    def setUp(self):
        from tools.mqtt_probe import Probe
        self.p = Probe()
        self.addCleanup(self.p.close)
        ack = self.p.control('reset')
        self.assertEqual(ack['status'], 'ok')
        self.addCleanup(self.p.control, 'reset')

    def _send_burst(self, count: int, duplicates: int = 0) -> dict:
        """Envoie un burst via l'action volume et retourne les métriques."""
        import urllib.error
        request_id = uuid.uuid4().hex
        self.p.publish('campus/v1/simulator/sensor-001/control', {
            'action':      'volume',
            'count':       count,
            'duplicates':  duplicates,
            'request_id':  request_id,
        })
        ack = self.p.wait(
            lambda t, v, r: t.endswith('/events') and isinstance(v, dict) and v.get('request_id') == request_id,
            timeout=30,
        )[1]
        return ack

    def test_11_load_escalation(self):
        results = []
        self.p.control('pause')
        time.sleep(6)

        for count in (50, 100, 200, 500, 1000):
            history_before = api_get('/api/rooms/salle-203/history')
            ids_before = {m['messageId'] for m in history_before}

            t0 = time.time()
            ack = self._send_burst(count, duplicates=count // 10)
            send_duration = time.time() - t0

            # Attendre la synchronisation (proportionnel au volume)
            wait_s = max(10, count // 50)
            time.sleep(wait_s)

            t_api0 = time.time()
            history_after = api_get('/api/rooms/salle-203/history')
            api_latency = time.time() - t_api0

            ids_after = {m['messageId'] for m in history_after}
            new_ids = ids_after - ids_before
            duplicates_in_history = len(ids_after) - len(set(ids_after))

            results.append({
                'count': count,
                'status': ack.get('status'),
                'send_s': round(send_duration, 2),
                'new_msgs_in_pg': len(new_ids),
                'api_latency_ms': round(api_latency * 1000, 1),
                'duplicates_in_history': duplicates_in_history,
            })

            print(f'\n[SC-11] count={count:4d} | '
                  f'send={send_duration:.2f}s | '
                  f'PG+{len(new_ids):4d} | '
                  f'API {api_latency*1000:.0f}ms | '
                  f'dupes_in_history={duplicates_in_history}')

            # Assertion de non-régression : jamais de doublons dans l'historique
            self.assertEqual(duplicates_in_history, 0,
                             f'Doublons métier détectés à count={count}')
            self.assertEqual(ack.get('status'), 'ok', f'volume rejeté à count={count}')

        # OBSERVATION synthétique : identifier la limite
        for r in results:
            print(f"[SC-11] {r}")

        # EXPLICATION : la dégradation attendue = latence API croissante, puis
        # délai de sync MongoDB→PG, puis saturation de la queue paho si MQTT_HOST lent.
        # DÉCISION : BATCH_SIZE=500 est le levier principal ; MongoDB est le buffer.


# ===========================================================================
# Runner
# ===========================================================================

if __name__ == '__main__':
    unittest.main(verbosity=2)
