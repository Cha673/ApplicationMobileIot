import os
import time
import unittest
import uuid
from test_model import command


@unittest.skipUnless(os.getenv('RUN_INTEGRATION') == '1', 'nécessite le kit Docker')
class MqttTests(unittest.TestCase):
    def setUp(self):
        from tools.mqtt_probe import Probe
        self.p = Probe()
        self.addCleanup(self.p.close)
        self.assertEqual(self.p.control('reset')['status'], 'ok')
        self.addCleanup(self.p.control, 'reset')
        self.base = 'campus/v1/devices/sensor-001/'

    def telemetry(self):
        return self.p.wait(lambda t, v, r: t == self.base+'telemetry' and isinstance(v, dict))[1]

    def result(self, cid):
        return self.p.wait(lambda t, v, r: t == self.base+'results' and v.get('command_id') == cid)[1]

    def test_measure_and_retained_state(self):
        from tools.mqtt_probe import Probe
        self.assertEqual(self.telemetry()['device_id'], 'sensor-001')
        with Probe(self.base+'state') as other:
            _, value, retained = other.wait(lambda t, v, r: r)
            self.assertIs(type(value['ventilation']), bool)
            self.assertTrue(retained)

    def test_command_confirmed_and_duplicate_result_stable(self):
        c = command(command_id=uuid.uuid4().hex)
        self.p.publish(self.base+'commands', c)
        first = self.result(c['command_id'])
        self.assertEqual(first['status'], 'executed')
        self.assertTrue(first['ventilation'])
        self.p.publish(self.base+'commands', c)
        self.assertEqual(first, self.result(c['command_id']))

    def test_invalid_command_and_no_response(self):
        c = command(command_id=uuid.uuid4().hex, enabled='true')
        self.p.publish(self.base+'commands', c)
        self.assertEqual(self.result(c['command_id'])['status'], 'rejected')
        self.p.control('no-response')
        c = command(command_id=uuid.uuid4().hex)
        self.p.publish(self.base+'commands', c)
        with self.assertRaises(TimeoutError):
            self.p.wait(lambda t, v, r: t == self.base+'results' and v.get('command_id') == c['command_id'], timeout=2)

    def test_duplicate_and_delayed_measure(self):
        from datetime import datetime, timezone
        self.telemetry()
        self.p.control('pause')
        # Le contrôle confirme que la dernière mesure est désormais figée.
        self.p.control('duplicate')
        a = self.telemetry()
        self.p.control('duplicate')
        b = self.telemetry()
        self.assertEqual(a, b)
        self.p.control('delay')
        old = self.telemetry()
        self.assertNotEqual(a['message_id'], old['message_id'])
        age = datetime.now(timezone.utc) - datetime.fromisoformat(old['observed_at'].replace('Z', '+00:00'))
        self.assertGreater(age.total_seconds(), 55)

    def test_invalid_payload_and_silence_then_resume(self):
        self.p.control('pause')
        with self.assertRaises(TimeoutError):
            self.p.wait(lambda t, v, r: t == self.base+'telemetry', timeout=3)
        self.p.control('invalid')
        self.assertEqual(self.telemetry()['co2']['value'], 'invalide')
        self.p.control('resume')
        self.assertIsInstance(self.telemetry()['co2']['value'], int)

    def test_high_and_normal_co2(self):
        self.p.control('high-co2')
        self.assertGreater(self.telemetry()['co2']['value'], 1400)
        self.p.control('normal-co2')
        self.assertLess(self.telemetry()['co2']['value'], 800)

    def test_backend_cannot_inject_telemetry_or_control_simulator(self):
        from tools.mqtt_probe import Probe
        with Probe(username='backend', password=os.getenv('BACKEND_PASSWORD', 'backend-demo')) as backend:
            marker = uuid.uuid4().hex
            backend.publish(self.base+'telemetry', {'forbidden': marker})
            with self.assertRaises(TimeoutError):
                self.p.wait(lambda t, v, r: isinstance(v, dict) and v.get('forbidden') == marker, timeout=2)
            backend.publish('campus/v1/simulator/sensor-001/control', {'action': 'pause', 'request_id': marker})
            with self.assertRaises(TimeoutError):
                self.p.wait(lambda t, v, r: t.endswith('/events') and v.get('request_id') == marker, timeout=2)
            self.telemetry()


if __name__ == '__main__':
    unittest.main()
