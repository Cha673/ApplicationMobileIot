#!/bin/bash
# Scenario 7b - Backend indisponible

echo "=== ETAT INITIAL ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print('Entrees avant:', len(d)); print('observedAt courant:', d[0]['observedAt'])"

echo ""
echo "=== ARRET du backend ==="
docker compose stop backend

echo ""
echo "=== ATTENTE 8s : capteurs publient sans backend ==="
sleep 8
echo "Messages publies pendant l'arret (via broker logs):"
docker compose logs --since 10s mosquitto 2>/dev/null | grep "campus.*telemetry" | wc -l | xargs echo "Connexions telemetrie:"

echo ""
echo "=== REDEMARRAGE du backend ==="
docker compose start backend

echo ""
echo "=== ATTENTE synchronisation (10s) ==="
sleep 10

echo ""
echo "=== VERIFICATION : messages recuperes ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -c "import sys,json; d=json.load(sys.stdin); print('Entrees apres:', len(d)); print('observedAt courant:', d[0]['observedAt'])"

echo ""
echo "=== LOGS : messages raw.accepted apres reprise ==="
docker compose logs --since 12s backend 2>/dev/null | grep "raw.accepted" | wc -l | xargs echo "Messages acceptes:"
