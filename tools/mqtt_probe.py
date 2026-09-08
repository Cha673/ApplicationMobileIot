"""Petit client de diagnostic, sans stockage, API ni logique métier backend."""
import json
import os
import queue
import threading
import time
import uuid
import paho.mqtt.client as mqtt


class Probe:
    def __init__(self, topic='campus/#', username=None, password=None):
        self.messages = queue.Queue()
        self.ready = threading.Event()
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='probe-' + uuid.uuid4().hex)
        self.client.username_pw_set(username or os.getenv('MQTT_USER', 'teacher'), password or os.getenv('MQTT_PASSWORD', 'teacher-demo'))
        def connect(c, u, f, rc, p):
            if not rc.is_failure:
                c.subscribe(topic, qos=1)
        self.client.on_connect = connect
        self.client.on_subscribe = lambda *args: self.ready.set()
        self.client.on_message = lambda c, u, m: self.messages.put((m.topic, m.payload.decode('utf-8', errors='replace'), m.retain))
        self.client.connect(os.getenv('MQTT_HOST', 'localhost'), int(os.getenv('MQTT_PORT', '1883')), 10)
        self.client.loop_start()
        if not self.ready.wait(8):
            self.close()
            raise RuntimeError('Connexion/abonnement MQTT non confirmé (identifiants ou broker)')

    def publish(self, topic, value, retain=False):
        info = self.client.publish(topic, json.dumps(value), qos=1, retain=retain)
        info.wait_for_publish(timeout=5)
        if not info.is_published():
            raise TimeoutError('Publication MQTT non confirmée')

    def wait(self, predicate, timeout=8, preserve=False):
        deadline = time.monotonic() + timeout
        pending = []
        while time.monotonic() < deadline:
            try:
                topic, raw, retained = self.messages.get(timeout=max(.01, deadline-time.monotonic()))
            except queue.Empty:
                break
            try:
                value = json.loads(raw)
            except ValueError:
                value = raw
            if predicate(topic, value, retained):
                for item in pending:
                    self.messages.put(item)
                return topic, value, retained
            if preserve:
                pending.append((topic, raw, retained))
        for item in pending:
            self.messages.put(item)
        raise TimeoutError('Message attendu non reçu')

    def control(self, action, device='sensor-001'):
        while not self.messages.empty():
            try:
                self.messages.get_nowait()
            except queue.Empty:
                break
        request_id = uuid.uuid4().hex
        self.publish(f'campus/v1/simulator/{device}/control', {'action': action, 'request_id': request_id})
        return self.wait(lambda t, v, r: t.endswith('/events') and isinstance(v, dict) and v.get('request_id') == request_id, preserve=action in ('duplicate', 'delay', 'invalid'))[1]

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
