import argparse
import json
import uuid
from datetime import datetime, timedelta, timezone
from tools.mqtt_probe import Probe
from simulator.main import ACTIONS


def main():
    parser = argparse.ArgumentParser(description='Diagnostic du kit campus (ne remplace pas le backend)')
    sub = parser.add_subparsers(dest='operation', required=True)
    watch = sub.add_parser('watch', help='Afficher les messages MQTT')
    watch.add_argument('--count', type=int, default=10)
    watch.add_argument('--topic', default='campus/#')
    cmd = sub.add_parser('command', help='Demander un état de ventilation et attendre le résultat')
    cmd.add_argument('device')
    cmd.add_argument('state', choices=['on', 'off'])
    incident = sub.add_parser('incident', help='Déclencher un incident pédagogique')
    incident.add_argument('device')
    incident.add_argument('action', choices=ACTIONS)
    args = parser.parse_args()
    try:
        with Probe(getattr(args, 'topic', 'campus/#')) as probe:
            if args.operation == 'watch':
                for _ in range(args.count):
                    topic, value, retained = probe.wait(lambda *a: True, timeout=15)
                    print(json.dumps({'topic': topic, 'retained': retained, 'payload': value}, ensure_ascii=False))
            elif args.operation == 'incident':
                print(json.dumps(probe.control(args.action, args.device), ensure_ascii=False))
            else:
                cid = uuid.uuid4().hex
                value = {'schema_version': 1, 'command_id': cid, 'action': 'set_ventilation', 'enabled': args.state == 'on',
                         'expires_at': (datetime.now(timezone.utc)+timedelta(seconds=15)).isoformat()}
                probe.publish(f'campus/v1/devices/{args.device}/commands', value)
                print(json.dumps(probe.wait(lambda t,v,r: t == f'campus/v1/devices/{args.device}/results' and isinstance(v, dict) and v.get('command_id') == cid)[1], ensure_ascii=False))
    except (TimeoutError, RuntimeError, OSError) as e:
        parser.exit(1, f'Diagnostic : {e}. Le résultat de la commande peut être inconnu.\n')


if __name__ == '__main__':
    main()
