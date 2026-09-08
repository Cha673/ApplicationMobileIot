import unittest
from datetime import datetime, timedelta, timezone
from simulator.model import Device, validate_command


def command(**changes):
    value = {'schema_version': 1, 'command_id': 'cmd-001', 'action': 'set_ventilation',
             'enabled': True, 'expires_at': (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()}
    return value | changes


class ModelTests(unittest.TestCase):
    def test_measurements_have_distinct_identity_and_units(self):
        d = Device('sensor-001', 'salle-203')
        a, b = d.measure(), d.measure()
        self.assertNotEqual(a['message_id'], b['message_id'])
        self.assertEqual(a['device_id'], 'sensor-001')
        self.assertEqual(a['temperature']['unit'], '°C')
        self.assertEqual(a['co2']['unit'], 'ppm')
        self.assertIsNotNone(datetime.fromisoformat(a['observed_at']).tzinfo)

    def test_ventilation_lowers_co2(self):
        d = Device('sensor-001', 'salle-203')
        d.co2 = 1500
        d.ventilation = True
        self.assertLess(d.measure()['co2']['value'], 1500)

    def test_expired_command_is_refused(self):
        with self.assertRaises(ValueError):
            validate_command(command(expires_at='2000-01-01T00:00:00Z'))

    def test_boolean_is_strict(self):
        for value in [1, 'true', None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_command(command(enabled=value))

    def test_bad_commands_are_refused(self):
        for value in [[], {}, command(action='toggle'), command(command_id=''), command(expires_at='bad'), command(expires_at='2030-01-01T00:00:00')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_command(value)

    def test_command_is_idempotent_and_conflict_is_refused(self):
        d = Device('sensor-001', 'salle-203')
        c = command()
        first = d.execute(c)
        self.assertEqual(first, d.execute(c))
        self.assertEqual(first['status'], 'executed')
        self.assertTrue(d.ventilation)
        with self.assertRaises(ValueError):
            d.execute(c | {'enabled': False})


if __name__ == '__main__':
    unittest.main()
