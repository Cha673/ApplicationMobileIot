"""Un client MQTT par objet ; toutes les mutations restent dans la boucle principale."""
import json
import logging
import math
import os
import queue
import re
import signal
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
import paho.mqtt.client as mqtt
from simulator.model import Device, now

LOG = logging.getLogger('simulator')
ACTIONS = ['pause', 'resume', 'duplicate', 'delay', 'invalid', 'high-co2', 'normal-co2', 'no-response', 'respond', 'reset', 'volume']


class Sensor:
    def __init__(self, entry):
        self.device = Device(entry['device_id'], entry['room_id'])
        self.base = f'campus/v1/devices/{self.device.device_id}/'
        self.control_topic = f'campus/v1/simulator/{self.device.device_id}/control'
        self.events_topic = f'campus/v1/simulator/{self.device.device_id}/events'
        self.inbox = queue.Queue(maxsize=1000)
        self.online = threading.Event()
        self.paused = self.no_response = False
        self.last = None
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='campus-'+self.device.device_id, clean_session=True)
        self.client.username_pw_set(os.getenv('MQTT_USER', 'simulator'), os.getenv('MQTT_PASSWORD', 'simulator-demo'))
        # L'heure du Will est inconnue lors de sa préparation : ne pas inventer un horodatage de panne.
        self.client.will_set(self.base+'availability', json.dumps({'schema_version': 1, 'device_id': self.device.device_id, 'status': 'offline', 'reason': 'connection_lost'}), qos=1, retain=True)
        self.client.reconnect_delay_set(1, 8)
        self.client.max_queued_messages_set(0)  # unlimited — volume bursts must not drop messages
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = lambda *args: self.online.clear()
        self.client.on_message = self.on_message

    def publish(self, suffix, value, retain=False, topic=None):
        info = self.client.publish(topic or self.base+suffix, json.dumps(value, ensure_ascii=False), qos=1, retain=retain)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            LOG.warning('%s publication non remise : %s', self.device.device_id, info.rc)
        return info

    def on_connect(self, client, userdata, flags, rc, properties):
        if rc.is_failure:
            LOG.error('%s connexion refusée : %s', self.device.device_id, rc)
            return
        client.subscribe([(self.base+'commands', 1), (self.control_topic, 1)])
        self.publish('availability', {'schema_version': 1, 'device_id': self.device.device_id, 'status': 'online', 'reported_at': now()}, True)
        self.publish('state', self.device.state(), True)
        self.online.set()
        LOG.info('%s connecté', self.device.device_id)

    def on_message(self, client, userdata, message):
        if message.retain:
            LOG.warning('%s message retained ignoré sur %s', self.device.device_id, message.topic)
            return
        if len(message.payload) > 4096:
            LOG.warning('%s message trop volumineux ignoré', self.device.device_id)
            return
        try:
            self.inbox.put_nowait((message.topic, json.loads(message.payload)))
        except (ValueError, UnicodeDecodeError, queue.Full):
            LOG.warning('%s message JSON invalide ou file pleine', self.device.device_id)

    def process(self):
        # Travail borné pour que les commandes ne bloquent pas la production des autres objets.
        for _ in range(100):
            try:
                topic, value = self.inbox.get_nowait()
            except queue.Empty:
                return
            if topic == self.control_topic:
                self.control(value)
            elif not self.no_response:
                try:
                    result = self.device.execute(value)
                    self.publish('state', self.device.state(), True)
                except ValueError as error:
                    result = {'schema_version': 1, 'device_id': self.device.device_id, 'command_id': value.get('command_id') if isinstance(value, dict) else None,
                              'status': 'rejected', 'reason': str(error), 'reported_at': now()}
                self.publish('results', result)

    def control(self, value):
        request_id = value.get('request_id') if isinstance(value, dict) else None
        action = value.get('action') if isinstance(value, dict) else None
        status = 'ok'
        if action not in ACTIONS:
            status = 'rejected'
        elif action == 'pause':
            self.paused = True
        elif action == 'resume':
            self.paused = False
        elif action == 'no-response':
            self.no_response = True
        elif action == 'respond':
            self.no_response = False
        elif action == 'high-co2':
            self.device.co2 = 1800
        elif action == 'normal-co2':
            self.device.co2 = 600
        elif action == 'reset':
            self.paused = self.no_response = False
            self.device.co2 = 650
            self.device.ventilation = False
            self.publish('state', self.device.state(), True)
        elif action == 'volume':
            count = value.get('count', 50) if isinstance(value, dict) else 50
            duplicates = value.get('duplicates', 0) if isinstance(value, dict) else 0
            if not isinstance(count, int) or not (1 <= count <= 1000):
                status = 'rejected'
            elif not isinstance(duplicates, int) or not (0 <= duplicates <= count):
                status = 'rejected'
            else:
                sent = []
                for _ in range(count):
                    msg = self.device.measure()
                    sent.append(json.loads(json.dumps(msg)))
                    self.publish('telemetry', msg)
                for i in range(duplicates):
                    self.publish('telemetry', sent[i % len(sent)])
        else:
            measure = self.last or self.device.measure()
            measure = json.loads(json.dumps(measure))
            if action == 'delay':
                measure['message_id'] = 'delayed-'+uuid.uuid4().hex
                measure['observed_at'] = (datetime.now(timezone.utc)-timedelta(seconds=60)).isoformat()
            elif action == 'invalid':
                measure['message_id'] = 'invalid-'+uuid.uuid4().hex
                measure['co2']['value'] = 'invalide'
            self.publish('telemetry', measure)
        self.publish('', {'request_id': request_id, 'device_id': self.device.device_id, 'action': action, 'status': status, 'reported_at': now()}, topic=self.events_topic)

    def tick(self):
        if self.online.is_set() and not self.paused:
            self.last = self.device.measure()
            self.publish('telemetry', self.last)

    def start(self):
        self.client.connect_async(os.getenv('MQTT_HOST', 'localhost'), int(os.getenv('MQTT_PORT', '1883')), keepalive=5)
        self.client.loop_start()

    def stop(self):
        if self.online.is_set():
            info = self.publish('availability', {'schema_version': 1, 'device_id': self.device.device_id, 'status': 'offline', 'reason': 'shutdown', 'reported_at': now()}, True)
            try:
                info.wait_for_publish(timeout=2)
            except RuntimeError:
                pass
        self.client.disconnect()
        self.client.loop_stop()


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    interval = float(os.getenv('PUBLISH_INTERVAL', '2'))
    if not math.isfinite(interval) or interval < .1:
        raise ValueError('PUBLISH_INTERVAL doit être au moins 0.1 seconde')
    with open('devices.json', encoding='utf-8') as f:
        entries = json.load(f)
    if not isinstance(entries, list) or not entries or len(entries) > 100:
        raise ValueError('devices.json : entre 1 et 100 objets')
    ids = set()
    for e in entries:
        if not isinstance(e, dict) or any(not isinstance(e.get(k), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', e[k]) for k in ('device_id', 'room_id')):
            raise ValueError('Identifiant objet/salle invalide')
        if e['device_id'] in ids:
            raise ValueError('device_id dupliqué')
        ids.add(e['device_id'])
    sensors = [Sensor(e) for e in entries]
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    try:
        for sensor in sensors:
            sensor.start()
        next_tick = time.monotonic()
        while not stop.wait(.05):
            for sensor in sensors:
                sensor.process()
            if time.monotonic() >= next_tick:
                for sensor in sensors:
                    sensor.tick()
                next_tick = time.monotonic() + interval
    finally:
        for sensor in sensors:
            sensor.stop()


if __name__ == '__main__':
    main()
