#!/bin/bash
# Scenario 13a - Montee en charge

echo "=== PAUSE du simulateur ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 pause
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-002 pause
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-003 pause
sleep 6

for COUNT in 50 200 500 1000; do
  echo ""
  echo "=== BURST $COUNT messages ==="
  BEFORE=$(curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))")

  MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 volume 2>/dev/null || true

  WAIT=$((COUNT / 50))
  if [ $WAIT -lt 10 ]; then WAIT=10; fi
  echo "Attente ${WAIT}s pour synchronisation..."
  sleep $WAIT

  AFTER=$(curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))")
  echo "count=$COUNT avant=$BEFORE apres=$AFTER nouveaux=$((AFTER - BEFORE))"
done

echo ""
echo "=== REPRISE du simulateur ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 resume
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-002 resume
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-003 resume
