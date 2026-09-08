# Contrat MQTT — version 1

Le kit utilise MQTT 3.1.1, TCP, port 1883. Le préfixe `campus/v1` et le champ `schema_version: 1` identifient ce contrat. Les messages sont des objets JSON encodés en UTF-8. Les dates utilisent ISO 8601 avec fuseau UTC (`Z` ou `+00:00`).

## Topics

Remplacer `{device_id}` par `sensor-001`, `sensor-002` ou `sensor-003`.

| Topic | Producteur | Consommateur | QoS publié | Retained |
|---|---|---|---|---|
| `campus/v1/devices/{device_id}/telemetry` | Objet | Backend | 1 | Non |
| `campus/v1/devices/{device_id}/state` | Objet | Backend | 1 | Oui |
| `campus/v1/devices/{device_id}/availability` | Objet/broker (Will) | Backend | 1 | Oui |
| `campus/v1/devices/{device_id}/commands` | Backend | Objet | 1 attendu | **Non** |
| `campus/v1/devices/{device_id}/results` | Objet | Backend | 1 | Non |
| `campus/v1/simulator/{device_id}/control` | Diagnostic enseignant | Simulateur | 1 | **Non** |
| `campus/v1/simulator/{device_id}/events` | Simulateur | Diagnostic enseignant | 1 | Non |

Le backend peut s’abonner avec `+` pour couvrir tous les objets. Il ne peut pas publier des mesures ni piloter les incidents. Le compte enseignant peut inspecter tous les topics du campus. Le compte simulateur est partagé entre les objets du kit, sans isolation d’identité par appareil : c’est une simplification pédagogique.

## Télémétrie

```json
{
  "schema_version": 1,
  "message_id": "bfa49075a42c4f63ae56d382bdb089ee-42",
  "device_id": "sensor-001",
  "room_id": "salle-203",
  "observed_at": "2026-09-08T09:00:00.000Z",
  "temperature": {"value": 22.14, "unit": "°C"},
  "co2": {"value": 912, "unit": "ppm"}
}
```

- `message_id` : identité de l’observation, identifiant de démarrage aléatoire + séquence. Un doublon rejoue exactement le même message ; un redémarrage produit de nouveaux identifiants.
- `device_id` : identité stable, identique à celle du topic ; vérifier cette cohérence à l’ingestion.
- `room_id` : affectation initiale indicative. Votre registre backend porte les réaffectations effectuées par l’application.
- `observed_at` : instant simulé de la mesure ; le backend peut ajouter son propre instant de réception.
- `value` : nombre fini pour les messages normaux. Les incidents peuvent volontairement violer le contrat.
- `unit` : unité explicite, à valider. La température varie autour de 22 °C, le CO₂ est borné à 420–2500 ppm dans le modèle normal.

Le modèle est une animation pédagogique, pas un calcul de ventilation ni un instrument de mesure. Sans ventilation, le CO₂ augmente d’environ 12 ppm par mesure ; avec ventilation, il baisse d’environ 45 ppm, avec une petite variation aléatoire. Changer la fréquence accélère donc aussi l’évolution simulée.

## Commande

```json
{
  "schema_version": 1,
  "command_id": "cmd-001",
  "action": "set_ventilation",
  "enabled": true,
  "expires_at": "2026-09-08T09:00:15.000Z"
}
```

**Générer une expiration future au moment de l’envoi** ; la date de cet exemple est illustrative. Le diagnostic `tools command` le fait automatiquement.

`command_id` contient 1 à 80 lettres ASCII, chiffres, tirets ou underscores. `enabled` est un booléen JSON strict (`true`/`false`). L’action autorisée est `set_ventilation`. L’expiration doit être dans le futur et inclure un fuseau. Les champs supplémentaires sont tolérés mais font partie du contenu comparé lors d’un doublon.

Le simulateur refuse une commande expirée ou mal formée. Un JSON illisible ou un message de plus de 4096 octets est ignoré avec une trace ; un `command_id` inexploitable peut produire un rejet sans corrélation utilisable. **N’attendez jamais indéfiniment un résultat.**

Les commandes doivent toujours être publiées sans retained. Les anciennes commandes reçues avec le drapeau retained à l’abonnement sont ignorées. Cela ne remplace pas la validation d’expiration : une publication retained peut aussi être livrée en direct aux clients déjà abonnés.

## Résultat et état

```json
{
  "schema_version": 1,
  "device_id": "sensor-001",
  "command_id": "cmd-001",
  "status": "executed",
  "executed_at": "2026-09-08T09:00:01.000Z",
  "ventilation": true
}
```

`executed` signifie que le modèle simulé a appliqué la consigne. Un rejet porte `status: "rejected"`, `reason` et `reported_at`. Le backend doit corréler le résultat à la demande, indépendamment des accusés MQTT.

État retained publié à la connexion et lors d’une commande réussie ou d’un reset :

```json
{
  "schema_version": 1,
  "device_id": "sensor-001",
  "reported_at": "2026-09-08T09:00:01.000Z",
  "boot_id": "bfa49075a42c4f63ae56d382bdb089ee",
  "ventilation": true
}
```

Un nouvel abonné reçoit le dernier état connu ; cela ne prouve pas que l’objet est disponible maintenant. La télémétrie et les résultats ne sont pas retained : le backend doit conserver ce dont son application a besoin.

## Disponibilité et reconnexion

En ligne : `schema_version`, `device_id`, `status: "online"`, `reported_at`.

Arrêt propre : mêmes champs avec `status: "offline"` et `reason: "shutdown"`.

Rupture imprévue : le broker publie le Will préparé par le client, avec `status: "offline"` et `reason: "connection_lost"`. Il **n’a pas de date de panne préremplie** ; le backend horodate sa réception. Keepalive : 5 secondes. Le délai de détection dépend de la coupure ; prévoir environ 8 à 15 secondes pour une suspension du simulateur.

Chaque objet a son client MQTT, avec des reconnexions espacées de 1 à 8 secondes. À la reconnexion, abonnements, disponibilité et état sont réannoncés. Le kit utilise des sessions propres : les commandes émises pendant l’absence de l’objet ne sont pas mises en attente pour lui. Le backend doit traiter l’absence de réponse.

Un capteur en mode `pause` reste connecté et continue d’accepter des commandes : seule sa télémétrie s’arrête. **Disponibilité réseau et fraîcheur des mesures sont deux informations distinctes.**

## Doublons et limites de persistance

QoS 1 peut livrer des doublons. Le simulateur garde les 1000 dernières commandes acceptées en mémoire. Rejouer le même contenu et le même `command_id`, avant expiration et tant qu’il est en cache, renvoie le même résultat. Réutiliser cet identifiant avec un contenu différent est refusé.

Le cache et la ventilation sont réinitialisés au redémarrage du simulateur. Il n’y a pas de garantie d’exécution unique durable au-delà de cette fenêtre. Une consigne absolue (« activer ») est utilisée, pas une inversion (« toggle »). Le backend doit définir sa propre politique de corrélation, de délais et de reprise.

Le broker conserve ses retained dans un volume Docker. Sa persistance n’est pas une base d’historique des mesures. Pendant une coupure du broker, le simulateur suspend la génération des mesures. Quelques messages déjà en transit peuvent être perdus ou livrés après reconnexion ; traiter leur date et leur identité. Le redémarrage du broker ne garantit pas la conservation de tout message arrivé juste avant une interruption brutale.

## Incidents

L’outil publie un objet `{"action": "pause", "request_id": "identifiant-unique"}` sur le topic `control`. Le simulateur répond sur `events` avec `request_id`, `device_id`, `action`, `status` (`ok` ou `rejected`) et `reported_at`.

Utiliser les actions documentées dans le README. `delay` injecte une observation distincte datée de 60 secondes auparavant ; `duplicate` conserve identité et date de la dernière mesure. `invalid` met `co2.value` à une chaîne. `no-response` ignore complètement les commandes pendant son activation, sans les conserver pour plus tard.

Le canal d’incident est réservé au diagnostic. Il ne fait pas partie de l’API métier que les étudiants doivent exposer.
