#!/bin/bash
echo "=== SCREENSHOT 1 : usurpation AVANT mitigation (teacher) ==="
docker exec applicationmobileiot-mosquitto-1 mosquitto_pub -h localhost -p 1883 -u teacher -P teacher-demo -t campus/v1/devices/sensor-001/telemetry -m '{"message_id":"usurp-test-003","device_id":"sensor-001","room_id":"salle-203","observed_at":"2026-09-18T11:10:00Z","temperature":{"value":99},"co2":{"value":500}}'
echo "Exit code: $?"

echo ""
echo "=== SCREENSHOT 2 : message usurpe present en base (attente synchro 7s) ==="
sleep 7
curl -s http://localhost:3000/api/rooms/salle-203/history | python3 -m json.tool | grep -A8 "usurp"

echo ""
echo "=== SCREENSHOT 3 : usurpation APRES mitigation (simulator = refuse) ==="
docker exec applicationmobileiot-mosquitto-1 mosquitto_pub -h localhost -p 1883 -u simulator -P simulator-demo -t campus/v1/devices/sensor-001/telemetry -m '{"message_id":"usurp-post-mitigation","device_id":"sensor-001","room_id":"salle-203","observed_at":"2026-09-18T11:10:00Z","temperature":{"value":99},"co2":{"value":500}}'
echo "Exit code: $?"
