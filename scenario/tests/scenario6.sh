#!/bin/bash
# Scenario 6 - Detection d'obsolescence (isStale)

echo "=== AVANT PAUSE : isStale doit etre false ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); print('isOnline:', d['isOnline']); print('isStale:', d['isStale']); print('lastTelemetryAt:', d['lastTelemetryAt'])"

echo ""
echo "=== MISE EN PAUSE du simulateur sensor-001 ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 pause

echo ""
echo "=== ATTENTE : verification toutes les 2s jusqu'a isStale=true ==="
for i in 1 2 3 4 5 6 7 8; do
  sleep 2
  RESULT=$(curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['isStale'])")
  echo "t=${i}s isStale=$RESULT"
  if [ "$RESULT" = "True" ]; then
    break
  fi
done

echo ""
echo "=== APRES 10s : isStale doit etre true, isOnline reste true ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); print('isOnline:', d['isOnline']); print('isStale:', d['isStale'])"

echo ""
echo "=== REPRISE du simulateur ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 resume
sleep 3

echo ""
echo "=== APRES REPRISE : isStale revient a false ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); print('isOnline:', d['isOnline']); print('isStale:', d['isStale'])"
