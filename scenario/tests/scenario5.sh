#!/bin/bash
# Scenario 5 - Ordre temporel et rejeu

echo "=== ETAT INITIAL : observedAt courant ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); m=d['latestMeasurement']; print('observedAt:', m['observedAt']); print('temperature:', m['temperature'])"

echo ""
echo "=== INJECTION : mesure retardee (observed_at = maintenant - 60s) ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 delay

echo ""
echo "=== ATTENTE synchronisation (7s) ==="
sleep 7

echo ""
echo "=== VERIFICATION : l'etat courant n'a pas change ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -c "import sys,json; d=json.load(sys.stdin); m=d['latestMeasurement']; print('observedAt:', m['observedAt']); print('temperature:', m['temperature'])"

echo ""
echo "=== HISTORIQUE : mesure retardee visible en derniere position ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print('Plus recent:', d[0]['observedAt']); print('Plus ancien:', d[-1]['observedAt'])"
