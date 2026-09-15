"""Modèle pédagogique, sans réseau ni backend étudiant."""
import random
import re
import uuid
from collections import OrderedDict
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def validate_command(value):
    if not isinstance(value, dict) or type(value.get('schema_version')) is not int or value['schema_version'] != 1:
        raise ValueError('schema_version doit être 1')
    if not isinstance(value.get('command_id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value['command_id']):
        raise ValueError('command_id invalide')
    if value.get('action') != 'set_ventilation' or type(value.get('enabled')) is not bool:
        raise ValueError('action ou enabled invalide')
    try:
        expires = datetime.fromisoformat(value['expires_at'].replace('Z', '+00:00'))
        if expires.tzinfo is None or expires <= datetime.now(timezone.utc):
            raise ValueError('commande expirée ou date sans fuseau')
    except (KeyError, TypeError, AttributeError) as e:
        raise ValueError('expires_at invalide') from e
    return value


class Device:
    def __init__(self, device_id, room_id):
        self.device_id, self.room_id = device_id, room_id
        self.boot_id = uuid.uuid4().hex
        self.sequence = 0
        self.co2 = 650.0
        self.ventilation = False
        self.results = OrderedDict()

    def measure(self):
        self.sequence += 1
        self.co2 = max(420, min(2500, self.co2 + (-45 if self.ventilation else 12) + random.uniform(-3, 3)))
        return {'schema_version': 1, 'message_id': f'{self.boot_id}-{self.sequence}',
                'device_id': self.device_id, 'room_id': self.room_id, 'observed_at': now(),
                'temperature': {'value': round(22 + random.uniform(-0.4, 0.4), 2), 'unit': '°C'},
                'co2': {'value': round(self.co2), 'unit': 'ppm'}}

    def state(self):
        return {'schema_version': 1, 'device_id': self.device_id, 'reported_at': now(),
                'boot_id': self.boot_id, 'ventilation': self.ventilation}

    def execute(self, value):
        validate_command(value)
        key = value['command_id']
        if key in self.results:
            original, result = self.results[key]
            if original != value:
                raise ValueError('command_id déjà utilisé avec un autre contenu')
            return result
        self.ventilation = value['enabled']
        result = {'schema_version': 1, 'device_id': self.device_id, 'command_id': key,
                  'status': 'executed', 'executed_at': now(), 'ventilation': self.ventilation}
        self.results[key] = (dict(value), result)
        if len(self.results) > 1000:
            self.results.popitem(last=False)
        return result
