#!/bin/bash
# Scenario 4 - Deduplication

echo "=== ETAT INITIAL : nombre de messages en base ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print('Entrees avant:', len(d))"

echo ""
echo "=== INJECTION : envoi du doublon (2x le meme message_id) ==="
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 duplicate
sleep 1
MQTT_PORT=1884 .venv/bin/python -m tools.cli incident sensor-001 duplicate

echo ""
echo "=== ATTENTE synchronisation (7s) ==="
sleep 7

echo ""
echo "=== VERIFICATION : nombre de messages inchange ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print('Entrees apres:', len(d))"

echo ""
echo "=== LOGS : evenements raw.duplicate dans les 15 dernieres secondes ==="
docker compose logs --since 15s backend 2>/dev/null | grep "raw.duplicate"
