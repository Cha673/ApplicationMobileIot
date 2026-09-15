"""Assertions réseau utilisées par la recette Docker."""
import sys
import time
from datetime import datetime, timezone
from tools.mqtt_probe import Probe


def main():
    mode = sys.argv[1]
    seen = set()
    deadline = time.monotonic()+25
    with Probe() as p:
        while len(seen) < 3:
            def matches(topic, value, retained):
                if not isinstance(value, dict):
                    return False
                if mode == 'fresh':
                    if not topic.endswith('/telemetry'):
                        return False
                    age = (datetime.now(timezone.utc)-datetime.fromisoformat(value['observed_at'].replace('Z','+00:00'))).total_seconds()
                    return 0 <= age < 10
                return topic.endswith('/availability') and value.get('status') == mode
            _, value, _ = p.wait(matches, timeout=max(.1, deadline-time.monotonic()))
            seen.add(value['device_id'])
    print(f'PASS {mode}: {sorted(seen)}')


if __name__ == '__main__':
    main()
