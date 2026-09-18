#!/bin/bash
# Scenario 7c - QoS 0 vs QoS 1

TOPIC=campus/v1/devices/sensor-001/telemetry
PUB_BASE="docker exec applicationmobileiot-mosquitto-1 mosquitto_pub -h localhost -p 1883 -u teacher -P teacher-demo"

echo "=== TEST QoS 0 : 5 messages envoyes pendant coupure broker ==="
docker compose stop mosquitto
sleep 2
for i in 1 2 3 4 5; do
  $PUB_BASE --qos 0 -t $TOPIC -m "{\"message_id\":\"qos0-$i\",\"device_id\":\"sensor-001\",\"room_id\":\"salle-203\",\"observed_at\":\"2026-09-18T13:0$i:00Z\",\"temperature\":{\"value\":21},\"co2\":{\"value\":600}}" 2>&1 || echo "QoS0 msg $i: echec (normal, broker down)"
done
docker compose start mosquitto
sleep 8
echo "Messages QoS0 recus dans backend:"
docker compose logs --since 10s backend 2>/dev/null | grep "qos0" | wc -l

echo ""
echo "=== TEST QoS 1 : 5 messages envoyes (broker UP cette fois) ==="
for i in 1 2 3 4 5; do
  $PUB_BASE --qos 1 -t $TOPIC -m "{\"message_id\":\"qos1-$i\",\"device_id\":\"sensor-001\",\"room_id\":\"salle-203\",\"observed_at\":\"2026-09-18T14:0$i:00Z\",\"temperature\":{\"value\":22},\"co2\":{\"value\":700}}"
done
sleep 7
echo "Messages QoS1 recus dans backend:"
docker compose logs --since 10s backend 2>/dev/null | grep "qos1" | wc -l
