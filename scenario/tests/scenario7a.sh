#!/bin/bash
# Scenario 7a - Broker indisponible

echo "=== AVANT COUPURE : telemetrie en cours ==="
docker compose logs --since 3s simulator 2>/dev/null | grep telemetry_published | tail -3

echo ""
echo "=== COUPURE du broker Mosquitto ==="
docker compose stop mosquitto

echo ""
echo "=== LOGS deconnexion (5s apres coupure) ==="
sleep 5
docker compose logs --since 8s simulator 2>/dev/null | grep -E "disconnected|reconnect"
docker compose logs --since 8s backend 2>/dev/null | grep -E "disconnected|reconnect"

echo ""
echo "=== REDEMARRAGE du broker ==="
docker compose start mosquitto

echo ""
echo "=== ATTENTE reconnexion (10s) ==="
sleep 10

echo ""
echo "=== LOGS reconnexion ==="
docker compose logs --since 12s simulator 2>/dev/null | grep -E "connected|reconnect"
docker compose logs --since 12s backend 2>/dev/null | grep -E "connected|reconnect"

echo ""
echo "=== VERIFICATION : telemetrie reprend ==="
docker compose logs --since 5s simulator 2>/dev/null | grep telemetry_published | tail -3
