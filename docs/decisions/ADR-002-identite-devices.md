# ADR-002 — Identité et adressage des devices

**Date :** 2026-09-17  
**Statut :** Accepté

## Contexte

Les devices doivent être identifiés sans ambiguïté à trois niveaux : le broker MQTT pour le
routage et le contrôle d'accès, le backend pour l'extraction de l'identité sans parsing du
payload, et PostgreSQL comme registre de référence. L'absence de convention explicite
exposerait le système à des collisions d'identité et rendrait les ACL Mosquitto impossibles
à appliquer par device.

## Décision

L'identité du device est encodée dans la hiérarchie de topic MQTT :
`campus/v1/devices/{deviceId}/{type}`. Le backend extrait `deviceId = topic.split('/')[3]`
avant toute lecture du payload. Le simulateur positionne `client_id = device_id` pour que
Mosquitto applique des ACL par device. `devices.json` à la racine du projet est la source
de vérité unique ; le backend la charge et la sèche dans PostgreSQL au démarrage.

## Alternatives envisagées

- **Identifiant uniquement dans le payload JSON, topic générique** — rejetée : le routage par
  le broker dépendrait alors du parsing du payload, ce qui mélange transport et contenu.
- **Enregistrement dynamique des devices via MQTT** — rejetée : ajoute une surface d'attaque
  et une complexité de gestion des états non justifiées pour ce prototype.
- **UUID générés à la volée par le simulateur** — rejetée : brise la correspondance avec les
  ACL Mosquitto et avec les entrées de `devices.json`.

## Conséquences

- Le broker route les messages sans jamais lire le payload, ce qui simplifie les ACL et
  réduit la surface d'attaque.
- `devices.json` est le seul endroit à modifier pour ajouter ou retirer un device ;
  le backend et Mosquitto sont resynchronisés au prochain démarrage.
- L'extraction de `deviceId` côté backend est une opération O(1) sur une chaîne de
  caractères, sans désérialisation préalable.
- Toute modification de la structure du topic (ajout d'un préfixe, changement de version)
  impose une mise à jour coordonnée du simulateur, de Mosquitto et du backend.
- Les ACL Mosquitto sont couplées aux valeurs de `device_id` définies dans `devices.json` ;
  un device non listé ne peut ni publier ni s'abonner.
