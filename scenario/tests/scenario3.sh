#!/bin/bash
# Scenario 3 - Validation des payloads
# 4 cas invalides injectes, puis verification que rien n'est en base

TOPIC=campus/v1/devices/sensor-001/telemetry
PUB="docker exec applicationmobileiot-mosquitto-1 mosquitto_pub -h localhost -p 1883 -u teacher -P teacher-demo"

echo "=== CAS 1 : JSON malformé ==="
$PUB -t $TOPIC -m '{bad json{{'
sleep 1

echo ""
echo "=== CAS 2 : Payload incomplet (device_id seulement) ==="
$PUB -t $TOPIC -m '{"device_id":"sensor-001"}'
sleep 1

echo ""
echo "=== CAS 3 : Valeur impossible (co2=-1) ==="
$PUB -t $TOPIC -m '{"message_id":"invalid-co2","device_id":"sensor-001","room_id":"salle-203","observed_at":"2026-09-18T12:00:00Z","temperature":{"value":21},"co2":{"value":-1}}'
sleep 1

echo ""
echo "=== CAS 4 : Type incorrect (co2 = chaine) ==="
$PUB -t $TOPIC -m '{"message_id":"invalid-type","device_id":"sensor-001","room_id":"salle-203","observed_at":"2026-09-18T12:00:01Z","temperature":{"value":21},"co2":{"value":"invalide"}}'
sleep 2

echo ""
echo "=== VERIFICATION : aucun message invalide dans l'historique ==="
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -m json.tool | grep -E "invalid|impossible" || echo "OK - aucun message invalide en base"

echo ""
echo "=== VERIFICATION : backend toujours vivant ==="
curl -s http://localhost:3000/api/rooms/salle-203 | python3 -m json.tool | grep -E "roomId|isOnline"
