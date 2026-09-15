"""Lance une recette isolée ; nécessite Python 3 et Docker Compose sur l'hôte."""
import os
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = 'campus-check-'+uuid.uuid4().hex[:8]
ENV = dict(os.environ, MQTT_PORT='0')  # port hôte libre, aucun conflit avec le cours


def dc(*args, check=True):
    return subprocess.run(['docker', 'compose', '-p', PROJECT, *args], cwd=ROOT, env=ENV, check=check)


def lifecycle(mode):
    dc('run', '--rm', '--no-deps', '--entrypoint', 'python', 'tools', '-m', 'tools.lifecycle', mode)


if __name__ == '__main__':
    try:
        dc('config', '--quiet')
        dc('build', 'simulator', 'tools', 'tests')
        dc('up', '-d', '--wait', 'mosquitto', 'simulator')
        dc('run', '--rm', '--no-deps', 'tests')
        dc('run', '--rm', '--no-deps', 'tools', 'command', 'sensor-001', 'on')
        denied = dc('exec', '-T', 'mosquitto', 'mosquitto_pub', '-h', 'localhost', '-t', 'campus/probe', '-m', 'anonymous', check=False)
        assert denied.returncode != 0, 'Un accès anonyme ne doit pas réussir'
        dc('stop', 'mosquitto')
        dc('up', '-d', '--wait', 'mosquitto')
        lifecycle('fresh')
        # Suspension : aucun DISCONNECT propre, le keepalive provoque le Last Will.
        dc('pause', 'simulator')
        lifecycle('offline')
        dc('unpause', 'simulator')
        lifecycle('fresh')
        dc('stop', 'simulator')
        lifecycle('offline')
        dc('up', '-d', 'simulator')
        lifecycle('fresh')
        print('RECETTE COMPLETE REUSSIE')
    finally:
        dc('unpause', 'simulator', check=False)
        dc('logs', '--tail', '30', check=False)
        dc('down', '-v', '--remove-orphans', check=False)
