#!/bin/bash
# Scenario 12 - Tracabilite de bout en bout

echo "=== ETAPE 1 : recuperer un messageId recent ==="
MID=$(curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['messageId'])")
echo "messageId: $MID"

echo ""
echo "=== ETAPE 2 : chercher ce messageId dans les logs backend ==="
docker compose logs --since 120s backend 2>/dev/null | grep "$MID"

echo ""
echo "Pour Grafana :"
echo "  Requete LogQL : {service_name=\"backend\"} |= \"$MID\""
echo "  Vous devez voir : mqtt.message_received, telemetry.saved, sync.batch_ok"
