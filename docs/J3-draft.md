# J3 — Sécuriser et fiabiliser le système IoT

**Situation :** le prototype fonctionne dans le cas nominal. Il faut maintenant vérifier qu’il reste cohérent quand les données sont incorrectes, qu’un capteur disparaît ou qu’un composant tombe en panne.

## Questions à résoudre

- Comment distinguer sans ambiguïté plusieurs capteurs simulés qui publient en parallèle ?
- Quelles données entrantes doivent être refusées avant d’atteindre le cœur du système ?
- Comment détecter qu’un capteur ne fournit plus une information suffisamment fraîche ?
- Comment le système se comporte-t-il lorsqu’un message est dupliqué, retardé ou invalide ?
- Que se passe-t-il si le broker MQTT devient indisponible puis revient ?
- Quels secrets et paramètres de configuration ne doivent jamais être versionnés dans Git ?

### 1. Isolation multi-capteurs - Iana

- **Travail :** Faire fonctionner plusieurs capteurs simulés en parallèle avec un identifiant stable et unique pour chacun.
- **Scénario :** **Isolation des devices** — Au moins deux capteurs simulés publient en parallèle sans mélange de données. Les logs permettent de suivre séparément chaque `deviceId`.
- **Jalon :** Le système distingue correctement plusieurs capteurs simulés.

-> Hypothèse  
 Chaque capteur possède un device_id stable issu de devices.json, publié sur son propre topic  
 MQTT. Le backend stocke et expose les données par device_id. Aucun mélange ne peut se produire.
Injection  
 Pile complète démarrée avec 3 capteurs. Observation sur une fenêtre de 10 secondes de logs en  
 conditions normales (sans intervention).  
 Observation  
 Parallélisme côté simulateur : les 3 capteurs publient en rafales quasi-simultanées (< 3 ms  
 d'écart), chacun avec son propre deviceId et son propre messageId :  
 07:18:04.510 sensor-001 messageId=5bdfd54a...-126  
 07:18:04.510 sensor-002 messageId=215c23fc...-126  
 07:18:04.512 sensor-003 messageId=fc6a4830...-126  
 Côté backend : 15 messages sur 10 s, exactement 5 par capteur — aucun déséquilibre, aucun  
 mélange. Zéro mismatch topic/deviceId.  
 API /api/rooms : 3 rooms distinctes, chacune liée à un seul capteur avec ses propres valeurs de
T° et CO2.  
 Historique : chaque endpoint /api/rooms/{roomId}/history ne contient que des lignes avec le  
 deviceId attendu — aucune contamination croisée.
Identifiant stable : chaque capteur conserve le même boot_id (préfixe du message_id) tout au  
 long de sa vie. Les 3 boot_id sont distincts et ne changent pas entre les ticks.
Explication  
 L'isolation est garantie par trois couches indépendantes :

1. MQTT — chaque topic inclut le device_id dans sa structure
   (campus/v1/devices/{deviceId}/telemetry). Le broker route les messages sans mélange.
2. Backend — parseTelemetry extrait device_id du payload ; MongoDB indexe par message_id (qui
   contient le boot_id du device) ; PostgreSQL filtre par device_id dans toutes les requêtes.
3. API — findHistoryByDevice(device.deviceId, limit) et findLatestByDevice(device.deviceId) sont
   strictement scopées au device_id du device associé à la room.  
   Décision  
   Comportement acceptable. Aucune modification nécessaire.  
   Vérification

- 0 mismatch topic/deviceId sur 15 messages observés
- 3 boot_id uniques et stables depuis le démarrage
- Chaque historique de room contient exclusivement son deviceId

### 2. Contrôle des accès & Topics - Iana

- **Travail :** Vérifier que les topics MQTT, le stockage et l’API permettent de distinguer clairement les données de chaque capteur.
- **Scénario :** **Usurpation d’un device** — Publier manuellement un message sur le topic d'un autre capteur et observer le rejet par le broker via la matrice ACL.
- **Jalon :** Le système distingue correctement plusieurs capteurs simulés.

### 3. Validation des payloads - Iana

- **Travail :** Valider les messages entrants avant leur traitement : structure invalide, champ obligatoire absent, valeur incohérente ou impossible.
- **Scénario :** **Payload invalide** — Envoyer un JSON invalide, un message incomplet puis une valeur hors norme. Traitement sans crash et avec rejet observable.
- **Jalon :** Les entrées invalides sont rejetées ou isolées sans compromettre le reste de l’application.

The validation happens in the backend, before the data enters any storage or log.  
 MQTT message arrives  
 │  
 ▼  
 parseTelemetry()  
 ├── Zod schema check ─── FAIL → logs "telemetry.rejected" → never stored  
 ├── range check ─── FAIL → logs "telemetry.rejected" → never stored  
 │  
 ▼ only if ALL checks pass  
 logs "telemetry.saved"  
 saves to MongoDB  
 │  
 ▼  
 sync to PostgreSQL  
 │  
 ▼  
 Grafana reads it  
 So by the time any value reaches Grafana — whether via Loki unwrap or a direct PostgreSQL query
— it has already passed Zod + range validation. A temperature of 999°C never appears in the  
 charts because it never reached telemetry.saved or PostgreSQL.  
 That's actually the argument for PostgreSQL over Loki for the sensor panels: with PostgreSQL,  
 the guarantee is even more explicit — the data went through validation → MongoDB → sync before  
 Grafana can touch it. With Loki unwrap, you're technically reading a value from a log string
(it's valid, but it feels fragile).

### 4. Gestion de la déduplication - Iana

- **Travail :** Définir le comportement attendu lorsqu’un même événement est reçu plusieurs fois.
- **Scénario :** **Doublon** — Envoyer deux fois exactement le même événement (`message_id` identique) et vérifier l’absence de doublon en base.
- **Jalon :** Les scénarios de doublon, retard et panne du broker ont été exécutés avec une preuve reproductible.

### 5. Ordre temporel et rejeu - Charlotte

- **Travail :** Vérifier qu’une mesure ancienne ne remplace pas silencieusement une information plus récente.
- **Scénario :** **Désordre et replay** — Envoyer des événements dans un ordre anachronique et rejouer une mesure ancienne. L'état courant conserve la valeur la plus récente (`observed_at`).
- **Jalon :** La fraîcheur des données est explicite et un capteur silencieux est détectable.

### 6. Détection d'obsolescence - Charlotte

- **Travail :** Détecter qu’un capteur est silencieux et distinguer la dernière valeur connue d’une donnée encore considérée comme fraîche.
- **Scénario :** **Capteur silencieux** — Arrêter brutalement un simulateur et mesurer le délai avant basculement de l'état en `isStale: true`.
- **Jalon :** La fraîcheur des données est explicite et un capteur silencieux est détectable.

### 7. Résilience et pannes MQTT - Iana

- **Travail :** Couper volontairement le broker MQTT, observer le comportement du système, puis vérifier la reprise après son redémarrage.
- **Scénarios associés :**
  - **Broker indisponible :** Coupure/relance du broker et vérification de la reconnexion backend.
  - **Backend indisponible :** Coupure du backend pendant la publication des capteurs et mesure des données récupérées à la reprise.
  - **QoS MQTT :** Comparaison des pertes/doublons entre QoS 0 et QoS 1 lors d'une panne.
  - **Message retained :** Ignorer les mesures de télémétrie conservées (`retained`) lors du redémarrage du consommateur.
- **Jalon :** Les scénarios de doublon, retard et panne du broker ont été exécutés avec une preuve reproductible.

Quand on a coupé le broker  
 Simulateur — il s'en aperçoit en moins d'une seconde et arrête immédiatement d'envoyer des  
 données. Il essaie de se reconnecter en boucle en attendant.  
 Backend — il reçoit un message automatique "tous les capteurs sont offline" (c'est le mécanisme
LWT du protocole MQTT), puis il essaie lui aussi de se reconnecter toutes les 3 secondes.
Pendant l'outage : aucune donnée n'est transmise, les capteurs sont marqués offline dans la  
 base.

Quand on a redémarré le broker
6 secondes après le redémarrage, tout est revenu à la normale :

- Simulateur reconnecté → reprend l'envoi de données
- Backend reconnecté → reçoit le message "capteurs online" et recommence à sauvegarder les  
  mesures  
  Les deux se sont reconnectés tout seuls, sans aucune intervention.

---

Ce qu'on perd  
 Les ~33 secondes de mesures pendant la panne sont perdues. Le système ne les stocke pas en
attendant que le broker revienne. Pour un proto c'est acceptable, mais c'est à noter.

---

Résumé en une phrase : le système résiste bien à une panne du broker — il se tait proprement
pendant la coupure et reprend tout seul en 6 secondes au redémarrage.

### 8. Hygiène de sécurité - Charlotte

- **Travail :** Vérifier qu’aucun secret sensible n’est présent dans Git et fournir un `.env.example` à jour.
- **Scénario :** **Audit des secrets** — Audit `git log` et recherche de clés/mots de passe dans le code source.
- **Jalon :** Les secrets et paramètres sensibles sont sortis du code source et du dépôt Git.

### 9. Stack d'observabilité centralisée - Iana

- **Travail :** Mettre en place une stack locale de centralisation et de visualisation des logs dans Docker Compose (Grafana + Loki + Promtail).
- **Scénario :** **Observabilité centralisée** — Collecte automatique des flux `stdout` de tous les conteneurs.
- **Jalon :** L’équipe peut expliquer quelles défaillances sont gérées, lesquelles ne le sont pas encore et pourquoi.

### 10. Formatage structuré des logs - Iana

- **Travail :** Produire les logs applicatifs sur `stdout` au format JSON délimité.
- **Scénario :** **Journalisation structurée** — Vérification du format des lignes émises par chaque service.
- **Jalon :** Les entrées invalides sont rejetées ou isolées sans compromettre le reste de l'application.

### 11. Schéma d'événement unifié - Iana

- **Travail :** Garantir la présence des clés minimales : `timestamp`, `service`, `level`, `eventType`, `deviceId`, `eventId`, `topic`, `status`, `reason`.
- **Scénario :** **Audit de conformité des champs** — Contrôle du schéma de log sur l'ensemble des points d’émission.
- **Jalon :** Les entrées invalides sont rejetées ou isolées sans compromettre le reste de l'application.

### 12. Traçabilité de bout en bout - Iana

- **Travail :** Suivre une mesure de sa réception à son archivage à l’aide d’un `eventId` (`message_id`).
- **Scénario :** **Traçabilité de bout en bout** — Corrélation dans Loki de l'événement de la réception MQTT jusqu’à la persistance en base.
- **Jalon :** Les scénarios de doublon, retard et panne du broker ont été exécutés avec une preuve reproductible.

### 13. Recommandations & Requêtes d'analyse - Iana

- **Travail :** Préparer des filtres LogQL pour isoler rapidement les anomalies (rejets, doublons, pannes).
- **Scénarios associés :**
  - **Montée en charge locale :** Observation des métriques de charge et identification du goulot d'étranglement (job de synchro DB).
  - **Provisioning des dashboards Grafana :** Automatisation des panneaux de visualisation.
- **Jalon :** L’équipe peut expliquer quelles défaillances sont gérées, lesquelles ne l

### Notifications sur application mobile - Charlotte

Protocole J3 — Scénario C complet :

- Hypothèse : le backend doit rejeter des valeurs physiquement impossibles
- Injection AVANT : T=999, CO2=-50, T=-999 → tous 3 acceptés (faille confirmée)
- Fix : constantes TEMP_MIN/MAX, CO2_MIN/MAX + deux garde-fous dans parseTelemetry
- Injection APRÈS : mêmes valeurs → tous 3 rejetés, event: telemetry.rejected, non persistés
- Décision : fix validé, la contrainte physique est maintenant enforced côté backend

---

Les 3 sous-tâches de validation sont terminées (A = structure invalide, B = champ absent, C =  
 valeur impossible). La prochaine étape selon le plan J3 est la détection de doublons (Step 3) —
le backend déduplique déjà par message_id, mais il faut rédiger et exécuter le protocole  
 expérimental pour le prouver.

    Synthèse — Preuve d'isolation sur les 3 couches

┌────────────────────┬─────────────────────────────────────────────┬────────────────────────┐  
 │ Couche │ Vérification │ Résultat │
├────────────────────┼─────────────────────────────────────────────┼────────────────────────┤  
 │ MQTT — topics │ 3 topics distincts │ ✓ un topic exclusif │  
 │ │ campus/v1/devices/{id}/telemetry │ par capteur │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤  
 │ MQTT — cohérence │ device_id dans le payload = segment [3] │ ✓ toujours │  
 │ │ du topic │ identiques │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤  
 │ MongoDB — séparation │ 3 device_id distincts, aucun boot_id │ ✓ 0 fuite croisée │
│ │ partagé │ │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤
│ MongoDB — dédup │ Index unique sur message_id │ ✓ unique: true │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤  
 │ PostgreSQL — séparation │ Aucun message_id avec 2 device_id │ ✓ 0 ligne │
│ │ différents │ │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤  
 │ PostgreSQL — │ Index (device_id, observed_at DESC) │ ✓ requêtes scopées │
│ performance │ │ │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤
│ API /api/rooms │ Chaque room liée à un seul deviceId │ ✓ 1:1 strict │  
 ├─────────────────────────┼─────────────────────────────────────────┼──────────────────────┤  
 │ API │ Historique contient uniquement le bon │ ✓ 0 contamination │
│ /api/rooms/:id/history │ deviceId │ │  
 └─────────────────────────┴─────────────────────────────────────────┴──────────────────────┘  
 Comment fonctionne l'isolation à chaque couche :

- MQTT — le topic lui-même encode le device_id (campus/v1/devices/sensor-001/telemetry). Le  
  broker route sans jamais mélanger les flux. Le device_id est aussi présent dans le payload —  
  parseTelemetry le valide et rejette tout message où les deux ne correspondent pas à un device
  connu.
- MongoDB — le champ device_id est stocké tel quel dans chaque document. L'index unique sur
  message_id (qui contient le boot_id propre à chaque capteur) garantit qu'un même message ne peut
  exister que pour un seul device.
- PostgreSQL — la primary key est message_id (unique), et l'index (device_id, observed_at DESC)
  permet à findLatestByDevice et findHistoryByDevice de lire uniquement les lignes du device  
  demandé, sans scan complet de la table.
- API — findAll() récupère tous les devices depuis PostgreSQL, puis chaque room est construite  
  en passant device.deviceId explicitement à findLatestByDevice(device.deviceId) et  
  findHistoryByDevice(device.deviceId, limit). Il est architecturalement impossible qu'une room
  retourne les données d'un autre capteur.

Ce qui a été fait  
 Corrections (2 bugs pré-existants)  
 backend/src/infrastructure/fallback.ts — 3 appels console.warn(...) en texte brut remplacés par
logger.warn('fallback.postgres_unavailable', { operation, error }). Tous les logs du backend  
 sont maintenant du JSON structuré.  
 backend/src/infrastructure/database.ts

- toDevice() : champ lastTelemetryAt manquant → ajouté
- runMigrations() : ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_telemetry_at TEXT ajouté  
  pour mettre à jour les bases existantes sans casser les nouvelles installations  
  Tests : tests/test_j3_logs.py
  ┌────────────────────┬───────────────────────────────────────────────────┬──────────────────┐
- runMigrations() : ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_telemetry_at TEXT ajouté
  pour mettre à jour les bases existantes sans casser les nouvelles installations

Tests : tests/test_j3_logs.py

┌────────────────────┬───────────────────────────────────────────────────┬──────────────────┐
┌────────────────────┬───────────────────────────────────────────────────┬──────────────────┐
│ Classe │ Tests │ Environnement │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogFormatTests │ Chaque ligne du simulateur et du backend est du │ Hôte (via docker │
│ │ JSON valide avec timestamp, service, level, event │ logs) │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogResilienceTests │ Payload non-JSON isolé, backend continue │ Docker │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogFormatTests │ Chaque ligne du simulateur et du backend est du │ Hôte (via docker │
│ │ JSON valide avec timestamp, service, level, event │ logs) │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogResilienceTests │ Payload non-JSON isolé, backend continue │ Docker │
│ │ JSON valide avec timestamp, service, level, event │ logs) │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogResilienceTests │ Payload non-JSON isolé, backend continue │ Docker │
│ LogResilienceTests │ Payload non-JSON isolé, backend continue │ Docker │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ │ Message trop grand (>4096 o) ignoré, simulateur │ Docker │
│ │ Message trop grand (>4096 o) ignoré, simulateur │ Docker │
│ Classe │ Tests │ Environnement │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogFormatTests │ Chaque ligne du simulateur et du backend est du │ Hôte (via docker │
│ │ JSON valide avec timestamp, service, level, event │ logs) │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ LogResilienceTests │ Payload non-JSON isolé, backend continue │ Docker │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ │ Message trop grand (>4096 o) ignoré, simulateur │ Docker │
│ │ continue │ │
├────────────────────┼───────────────────────────────────────────────────┼──────────────────┤
│ │ Mesure invalide (co2=string) rejetée, non │ Docker │
│ │ persistée │ │
└────────────────────┴───────────────────────────────────────────────────┴──────────────────┘

En clair, ce qu'on a fait  
 Problème de départ : Dans le backend, quand PostgreSQL tombe en panne et que le système bascule
sur MongoDB, il écrivait des messages comme ça dans la console :  
 [fallback] postgres unavailable, reading from mongo  
 C'est du texte brut — illisible par une machine, impossible à filtrer ou analyser  
 automatiquement.  
 Ce qu'on a corrigé : Ces messages s'écrivent maintenant comme le reste des logs :  
 {"timestamp":"2026-09-17T09:44:02Z","service":"backend","level":"warn","event":"fallback.postgre
s_unavailable","operation":"findLatestByDevice","error":"..."}  
 Pourquoi c'est important : Tous les logs du système (simulateur + backend) sont maintenant dans
le même format JSON. Ça veut dire que Grafana, ou n'importe quel outil de monitoring, peut lire,
filtrer et alerter sur ces logs automatiquement.

---

Les tests vérifient deux choses :

1. Format : on lit les logs de chaque conteneur et on vérifie que chaque ligne est bien du JSON
   avec les bons champs. Si quelqu'un ajoute un console.log("debug") quelque part, le test échoue.
2. Résilience : on envoie volontairement des messages pourris (JSON cassé, message de 5000
   octets, valeur de CO₂ impossible) et on vérifie que le service continue à fonctionner  
   normalement après. Le but : une mauvaise donnée ne doit jamais faire planter le reste.

What changed

1. logger.ts — champ event → eventType  
   Avant, le champ s'appelait event. Maintenant il s'appelle eventType dans chaque ligne JSON  
   émise.  
   { "timestamp": "...", "service": "backend", "level": "info", "eventType": "telemetry.saved", ...
   }

---

2. domain/types.ts — RejectedEvent.messageId → RejectedEvent.eventId
   Le champ interne qui portait l'ID du message dans un événement rejeté s'appelle maintenant
   eventId, cohérent avec le nom du champ dans les logs.

---

3. telemetryService.ts — processAvailability reçoit topic
   La signature prend maintenant topic: string en troisième paramètre pour que les logs
   d'availability l'incluent.

---

4. mqtt.ts — deux corrections

- mqtt.parse_error : ajout de reason: 'invalid_json'
- appel de processAvailability : passe maintenant topic

---

5. promtail/config.yaml — label eventType au lieu de event  
   Loki indexe maintenant eventType comme label searchable.

---

Résultat : ce que contient chaque événement significatif  
 ┌───────────────┬───────┬──────┬─────┬───────┬───────┬──────┬─────┬───────────┬─────────┐  
 │ eventType │ times │ serv │ lev │ event │ devic │ even │ top │ status │ reason │  
 │ │ tamp │ ice │ el │ Type │ eId │ tId │ ic │ │ │
├───────────────┼───────┼──────┼─────┼───────┼───────┼──────┼─────┼───────────┼─────────┤  
 │ telemetry.sav │ ✅ │ ✅ │ inf │ ✅ │ ✅ │ ✅ │ ✅ │ accepted │ — │
│ ed │ │ │ o │ │ │ │ │ │ │  
 ├───────────────┼───────┼──────┼─────┼───────┼───────┼──────┼─────┼───────────┼─────────┤  
 │ │ │ │ │ │ ✅ │ ✅ │ │ │ │
│ telemetry.rej │ ✅ │ ✅ │ war │ ✅ │ (si c │ (si │ ✅ │ rejected │ ✅ │  
 │ ected │ │ │ n │ │ onnu) │ conn │ │ │ │
│ │ │ │ │ │ │ u) │ │ │ │  
 ├───────────────┼───────┼──────┼─────┼───────┼───────┼──────┼─────┼───────────┼─────────┤
│ telemetry.dup │ ✅ │ ✅ │ war │ ✅ │ ✅ │ ✅ │ ✅ │ skipped │ — │  
 │ licate │ │ │ n │ │ │ │ │ │ │
├───────────────┼───────┼──────┼─────┼───────┼───────┼──────┼─────┼───────────┼─────────┤  
 │ availability. │ ✅ │ ✅ │ inf │ ✅ │ ✅ │ — │ ✅ │ online/of │ — │  
 │ updated │ │ │ o │ │ │ │ │ fline │ │
├───────────────┼───────┼──────┼─────┼───────┼───────┼──────┼─────┼───────────┼─────────┤  
 │ mqtt.parse_er │ ✅ │ ✅ │ err │ ✅ │ — │ — │ ✅ │ — │ invalid │
│ ror │ │ │ or │ │ │ │ │ │ \_json │  
 └───────────────┴───────┴──────┴─────┴───────┴───────┴──────┴─────┴───────────┴─────────┘
Exemple de ligne réelle pour un rejet :  
 {  
 "timestamp": "2026-09-17T10:42:00.000Z",  
 "service": "backend",  
 "level": "warn",  
 "eventType": "telemetry.rejected",  
 "topic": "campus/v1/devices/dev-01/telemetry",  
 "deviceId": "dev-01",  
 "eventId": "msg-abc123",  
 "reason": "value_out_of_range",  
 "field": "temperature",  
 "value": 150,  
 "min": -50,  
 "max": 100,  
 "status": "rejected"  
 }

    To satisfy the traceability requirement: any telemetry measurement must be traceable end-to-end

— from the moment it arrives on the MQTT broker, through validation, persistence, and sync —  
 using a single shared identifier (eventId) that appears in every log line.

---

What was done
mqtt.ts

- Import randomUUID from Node's built-in crypto
- On every incoming message, generate a correlationId (UUID) immediately — before any parsing
- For telemetry: use message_id from the payload as eventId if it's a valid string, otherwise  
  fall back to the UUID (e.g. malformed payloads)
- Added mqtt.message_received log at the reception point with eventId
- mqtt.parse_error (invalid JSON) now also carries eventId
- Pass eventId into processTelemetry  
  telemetryService.ts
- processTelemetry now takes eventId: string as a third parameter
- Threads it into parseTelemetry
- Schema-failure rejections (e.g. missing message_id) now always include eventId — previously  
  they had none
- Range-failure rejections now use the same eventId parameter instead of re-reading message_id  
  from parsed data
- sync.batch_ok and sync.batch_failed now log eventIds: string[] so the sync step is also  
  traceable

---

What was tested  
 Type-check via tsc --noEmit — no new errors introduced. The 3 errors that appeared (zod and
mongodb module not found, implicit any in a Zod refine callback) are pre-existing and unrelated
to these changes.

---

Result
Every log line for a given measurement now shares the same eventId:
mqtt.message_received { eventId: "msg-abc-123" } ← reception
telemetry.saved { eventId: "msg-abc-123" } ← accepted & stored  
 sync.batch_ok { eventIds: ["msg-abc-123"] } ← synced to main DB  
 For a rejected/unparseable message:  
 mqtt.message_received { eventId: "550e8400-..." } ← UUID fallback  
 telemetry.rejected { eventId: "550e8400-..." } ← same ID, fully traceable  
 You can now filter any log stream by eventId to reconstruct the full lifecycle of any single  
 measurement.
