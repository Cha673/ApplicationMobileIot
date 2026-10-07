Résolutions et justifications des issues

Contexte

À J3, le système fonctionne correctement pour 3 capteurs publiant à 0,5 msg/s chacun.

Toute la logique — réception MQTT, validation, écriture MongoDB, synchronisation PostgreSQL — s'exécute dans un seul processus Node.js, orchestrée par un setInterval.

Avant d'aller plus loin, il faut comprendre pourquoi cette architecture tient à faible charge, puis identifier précisément ce qui casse quand le volume augmente.

Problèmes de l'architecture sans workers

1. La réception MQTT et le traitement partagent la même boucle

Dans l'ancienne architecture, handleMessage appelait directement service.saveRaw() :

client.on('message', (topic, payload) => {
handleMessage(topic, payload, service) // bloque tant que saveRaw() n'a pas fini
})

async function handleMessage(topic, payload, service) {
await service.saveRaw(topic, payload) // INSERT MongoDB — peut prendre 10–50 ms
}

Node.js est single-threaded. Pendant que saveRaw() attend la réponse de MongoDB, aucun autre message ne peut être dépilé de la file interne du client MQTT.

À faible débit (1,5 msg/s), MongoDB répond en < 5 ms — aucun problème visible.

À 500 msg/s, les 500 insertions s'accumulent. Si chacune prend 10 ms, la file interne du client MQTT déborde et des messages sont silencieusement abandonnés.

Conséquence : la vitesse de réception est plafonnée par la vitesse d'écriture MongoDB.

2. processRawBatch et syncBatch sont enchaînés dans le même timer

setInterval(() => {
this.processRawBatch() // valide jusqu'à 500 messages
.then(() => this.syncBatch()); // puis synchronise — seulement après
}, 5000);

Si processRawBatch prend 3 secondes (charge élevée), syncBatch ne démarre qu'à t+3s, puis le prochain cycle débute à t+5s. Les deux opérations se volent du temps.

Si MongoDB est lent pendant processRawBatch, syncBatch est retardé d'autant — et les données n'arrivent pas dans PostgreSQL pour l'API.

Conséquence : un composant lent ralentit toute la chaîne.

3. Pas de tampon entre MQTT et MongoDB

Si MongoDB est temporairement indisponible (redémarrage, pic de charge), saveRaw() lève une exception. Le message est perdu — il n'existe nulle part avant l'écriture.

Avec clean=false côté broker, les messages MQTT sont conservés dans la session broker.

Mais si le backend redémarre pendant la panne MongoDB, la session broker redelivre les messages et ils sont perdus au même endroit.

Conséquence : MongoDB est un point de défaillance unique pour la réception.

4. Capacité de traitement fixe et non ajustable

BATCH_SIZE = 500 et SYNC_INTERVAL_MS = 5000 sont des constantes de configuration.

Pour doubler le débit de traitement, il faut modifier la config et redémarrer le process.

Il n'est pas possible d'ajouter un second "worker de validation" sans restructurer le code.

Conséquence : le système ne peut pas scaler horizontalement sans refactoring.

Pourquoi ajouter des workers

L'objectif n'est pas de supporter 1 million de messages pour ce prototype.

C'est de séparer les responsabilités de façon à ce que chaque étape soit indépendante, observable et résistante aux pannes des étapes voisines.

Problème

Solution apportée par les workers

Réception bloquée par MongoDB

ingestQueue.add() retourne en < 1 ms — MongoDB n'est plus sur le chemin critique

Validation ralentit la sync

Deux workers indépendants, chacun à son propre rythme

MongoDB indisponible = messages perdus

Redis conserve les jobs en attente pendant la panne

Pas de scaling horizontal

concurrency: 5 sur l'ingestWorker = 5 validations en parallèle, ajustable sans code

Pas de visibilité sur la file

BullMQ expose l'état de chaque job (waiting, active, failed, completed)

Comment c'est implémenté

Vue d'ensemble

MQTT Mosquitto
│
│ client.on('message')
▼
mqtt.ts — handleMessage()
│ ingestQueue.add({topic, payload}) ← retourne immédiatement
▼
REDIS — queue "ingest"
│ stocke les jobs {topic, payload}
▼
ingestWorker.ts (concurrency=5)
│ service.ingestOne(topic, payload, onValidated)
│ 1. rawEvents.save() → MongoDB raw_events (audit brut)
│ 2. JSON.parse() → rejet si invalide
│ 3. Zod validation → rejet si schéma incorrect
│ 4. plausibilité physique → rejet si valeur impossible
│ 5. existsById() → rejet si doublon
│ 6. rawMeasurements.save() → MongoDB measurements (synced=false)
│ 7. onValidated() → syncQueue.add('trigger', jobId='sync-singleton', delay=2s)
▼
REDIS — queue "sync"
│ job dédupliqué : si un trigger existe déjà, le nouveau est ignoré
│ delay=2s : attend 2s pour accumuler plusieurs messages avant de déclencher
▼
syncWorker.ts (concurrency=1)
│ service.syncBatch()
│ findUnsynced(500) → MongoDB measurements (synced=false)
│ measurements.saveBatch() → PostgreSQL ON CONFLICT DO NOTHING
│ markSyncedBatch() → MongoDB measurements (synced=true)
▼
POSTGRESQL — measurements
▼
API REST → Application mobile

Fichiers modifiés

backend/src/infrastructure/mqtt.ts

Avant :

await service.saveRaw(topic, payload); // bloquant

Après :

await ingestQueue.add("raw-telemetry", { topic, payload }); // non-bloquant

handleMessage ne touche plus MongoDB. Elle enfile et retourne.

backend/src/application/telemetryService.ts

startSyncLoop, saveRaw et processRawBatch sont supprimés.

Remplacés par deux méthodes publiques :

ingestOne(topic, payload, onValidated) — traite un seul message de bout en bout. Contient exactement la même logique de validation que l'ancien processRawBatch, mais pour un message à la fois. Appelée par ingestWorker.

syncBatch() — inchangée dans sa logique. Elle lit findUnsynced(500) depuis MongoDB et insère en batch dans PostgreSQL. Appelée par syncWorker.

backend/src/workers/ingestWorker.ts

new Worker(
"ingest",
async (job) => {
const { topic, payload } = job.data;

    await service.ingestOne(topic, payload, async () => {
      await syncQueue.add(
        "trigger",
        {},
        {
          jobId: "sync-singleton", // même ID = BullMQ déduplique
          delay: 2000, // attend 2s pour batcher les triggers
          removeOnComplete: true,
        },
      );
    });

},
{ connection: redis, concurrency: 5 },
);

Le jobId: 'sync-singleton' est le mécanisme central de batching :

si 100 messages sont validés en 1 seconde, 100 triggers sont soumis à Redis, mais BullMQ n'en garde qu'un seul en attente. Ce trigger unique déclenche un syncBatch() qui traite les 100 messages d'un coup.

backend/src/workers/syncWorker.ts

new Worker(
"sync",
async () => {
await service.syncBatch();
},
{ connection: redis, concurrency: 1 },
);

concurrency: 1 garantit qu'un seul syncBatch s'exécute à la fois, évitant des insertions PostgreSQL concurrentes sur le même lot.

backend/src/index.ts

Avant :

service.startSyncLoop(5000);
connectMqtt(host, port, user, password, service);

Après :

const redis = { host: REDIS_HOST, port: REDIS_PORT };

const ingestQueue = new Queue("ingest", { connection: redis });
const syncQueue = new Queue("sync", { connection: redis });

startIngestWorker(redis, service, syncQueue);
startSyncWorker(redis, service);

connectMqtt(host, port, user, password, ingestQueue, service);

compose.yaml

Redis ajouté comme service :

redis:
image: redis:7-alpine
healthcheck:
test: ["CMD", "redis-cli", "ping"]

Le backend dépend de Redis (depends_on: redis: condition: service_healthy) et reçoit REDIS_HOST=redis, REDIS_PORT=6379 en variables d'environnement.

Ce que cette architecture change concrètement

Comportement en cas de panne MongoDB

Avant : saveRaw() lève une exception → message perdu.

Après : ingestQueue.add() réussit toujours (Redis est disponible).

Le job reste dans la queue Redis. Quand MongoDB revient, l'ingestWorker reprend les jobs en attente automatiquement (BullMQ retry).

Comportement sous charge

Avant : 500 msg/s → 500 saveRaw() concurrents → saturation MongoDB → perte de messages.

Après : 500 msg/s → 500 ingestQueue.add() (< 1 ms chacun) → Redis absorbe → 5 workers traitent en parallèle à leur rythme → MongoDB reçoit des insertions régulières.

Visibilité

BullMQ expose l'état de chaque queue. On peut à tout moment connaître :

le nombre de jobs en attente (waiting)

les jobs en cours (active)

les jobs échoués (failed) avec leur erreur et leur stack trace

le débit traité (completed)

Sans workers, un message perdu dans setInterval ne laisse aucune trace.

Limites connues

Redis est un nouveau point de défaillance. Si Redis tombe, la réception MQTT s'arrête (ingestQueue.add() échoue). Mitigation : Redis persistence (appendonly yes) et healthcheck dans Docker Compose.

Les jobs ingest sont retentables mais pas idempotents à 100 %. Si saveRaw() réussit mais que la validation échoue à mi-chemin et que le job est retenté, un second document raw_events est créé pour le même message MQTT. C'est acceptable pour un audit log — measurements reste dédupliqué par message_id.

sync-singleton peut manquer des messages si Redis redémarre entre le trigger et l'exécution. Dans ce cas, les documents synced=false restent dans MongoDB. Au redémarrage du backend, le premier message validé déclenche un nouveau trigger et rattrape le retard.

Monitoring BullMQ non inclus dans cette version. Bull Board (UI officielle) peut être ajouté comme service Docker pour visualiser les queues en temps réel.

2. Découplage réel entre ingestion et consolidation

Oui. La consolidation peut être indisponible sans empêcher l’ingestion de continuer. L’architecture mise en place sépare clairement les deux traitements grâce à deux workers indépendants : le worker d’ingestion reçoit les messages MQTT et les stocke dans MongoDB, tandis que le worker de synchronisation récupère ensuite les données validées pour les transmettre à PostgreSQL.

Ainsi, la synchronisation vers PostgreSQL n’est plus directement sur le chemin de réception des messages MQTT. Les données validées restent disponibles dans MongoDB avec synced=false en attendant leur consolidation. La consolidation peut donc prendre du retard ou être temporairement indisponible sans bloquer l’ingestion des nouveaux messages.

Le découplage permet donc à chaque étape de fonctionner à son propre rythme : l’ingestion continue d’alimenter MongoDB, tandis que la synchronisation vers PostgreSQL traite les données accumulées dès qu’elle est disponible.

3. Scalabilité du job de synchronisation

La synchronisation utilise une queue BullMQ commune aux différentes instances du backend. Chaque instance possède un worker de synchronisation avec concurrency: 1, ce qui évite d’exécuter plusieurs synchronisations en même temps dans une même instance.

Côté PostgreSQL, les doublons sont évités grâce à la contrainte unique sur message_id et à ON CONFLICT DO NOTHING. Ainsi, si deux workers essaient de traiter le même événement, PostgreSQL n’enregistre qu’une seule fois cet événement.

En revanche, deux instances peuvent actuellement récupérer en même temps les mêmes documents synced:false, car leur sélection n’est pas atomique. Il n’y a pas encore de mécanisme de claim ou de lease permettant à un worker de réserver un lot avant de le traiter.

Le système supporte donc les retraitements et évite les doublons en base, mais la répartition des lots entre plusieurs instances n’est pas encore garantie sans chevauchement.

4. Registre backend et identité reçue du device

Le backend applique désormais une règle d’autorité explicite pour les messages de télémétrie :

l’identifiant du device présent dans le topic est l’identité de transport ;

le registre backend est l’autorité pour les devices autorisés et leur salle ;

le device_id du payload doit correspondre à celui du topic ;

le room_id du payload doit correspondre à l’affectation du registre.

Un message publié sur le topic de sensor-001 avec device_id=sensor-999 est donc rejeté avec la raison device_identity_mismatch. Un device absent du registre est rejeté avec unknown_device, et une salle différente de celle du registre avec room_assignment_mismatch. Dans tous ces cas, la mesure n’est pas écrite dans measurements MongoDB.

Cette validation distingue ainsi :

identité : le device déclaré par le topic et confirmé par le payload ;

autorisation : le device doit exister dans le registre backend ;

affectation métier : la salle du registre doit correspondre à celle du message.

Le contrôle est effectué avant rawMeasurements.save(). Les événements bruts restent toutefois conservés dans raw_events et sont marqués rejected, ce qui permet de conserver une trace des tentatives invalides.

5. Mesures retardées : conservation et fraîcheur

Une mesure ancienne n'est pas nécessairement fausse. La décision retenue est donc de conserver toute mesure qui est valide sur le plan syntaxique, identitaire et physique, même si elle arrive tardivement. Elle reste disponible dans l'historique et peut être utilisée dans les agrégations correspondant à sa date observed_at.

Il faut distinguer :

invalid : la donnée ne respecte pas le contrat (JSON, schéma, identité, device autorisé ou limites physiques) ; elle est rejetée avant measurements ;

stale : la donnée est valide, mais son horodatage est trop ancien pour représenter l'état courant ; elle est conservée, mais ne doit pas rajeunir l'indicateur de fraîcheur ;

current state : la dernière mesure selon observed_at, et non la dernière mesure reçue par le backend.

Le stockage conserve donc l'information historique, tandis que la lecture de latestMeasurement utilise l'ordre décroissant sur observed_at. Une mesure retardée ne peut ainsi pas remplacer une mesure plus récente.

La fraîcheur du device est également monotone : last_telemetry_at est mis à jour avec observed_at uniquement si cette date est plus récente que la valeur déjà enregistrée. Une mesure reçue en retard ne peut donc pas faire régresser la date de l'état courant ni faire croire qu'un device vient d'émettre.

La règle est donc : ancienne ne signifie pas invalide. La mesure est rejetée uniquement si elle est incorrecte ; si elle est simplement tardive, elle est archivée et signalée comme potentiellement stale selon le seuil de fraîcheur.

6. Fraîcheur : received_at ou observed_at ?

La fraîcheur métier est calculée à partir de observed_at, qui représente le moment où la mesure a été produite par le device. Une mesure reçue aujourd'hui mais observée plusieurs minutes auparavant est donc signalée comme stale.

received_at représente le moment où le backend a reçu ou traité la mesure. Il reste conservé pour mesurer le retard de transmission et diagnostiquer les problèmes réseau, mais ne sert pas au calcul de la fraîcheur métier.

Le système distingue ainsi le temps d'observation, le temps de réception et l'indicateur isStale. Ce choix évite de confondre une réception récente avec une mesure réellement récente.

7. Fallback PostgreSQL vers MongoDB

Le fallback permet de maintenir certaines lectures de mesures lorsque PostgreSQL est indisponible. PostgreSQL reste la source principale ; MongoDB est utilisée comme source de secours par FallbackMeasurementRepository.

Les deux bases exposent la même structure métier pour les mesures et appliquent le même ordre sur observed_at, received_at et message_id. Les calculs d'historique et de moyenne de température sont donc sémantiquement équivalents.

Cependant, MongoDB peut contenir des mesures validées avec synced=false. Ces mesures ont été acceptées par le pipeline d'ingestion, mais ne sont pas encore consolidées dans PostgreSQL. En cas de fallback, l'utilisateur peut donc voir des données plus récentes que celles présentes dans PostgreSQL.

Le fallback assure ainsi une disponibilité technique et une cohérence sémantique des lectures de mesures, mais pas une cohérence instantanée entre les deux bases. L'indisponibilité de PostgreSQL est actuellement enregistrée dans les logs, mais n'est pas signalée explicitement dans la réponse HTTP.

Le fallback ne couvre pas encore le registre des devices : les endpoints qui dépendent directement de PgDeviceRepository peuvent rester indisponibles si PostgreSQL est arrêté. Il s'agit donc d'un mode dégradé partiel, et non d'une continuité fonctionnelle complète de toute l'API.

8. Healthcheck réel du système

Le healthcheck distingue trois notions :

/api/health/live vérifie uniquement que le processus HTTP est vivant ;

/api/health/ready vérifie les dépendances et renvoie 503 si le système est indisponible pour les fonctions critiques ;

/api/health fournit le diagnostic détaillé.

Le diagnostic vérifie PostgreSQL avec SELECT 1, MongoDB avec ping, Redis avec une lecture de l'état des queues BullMQ et MQTT avec l'état de connexion du client. Il expose aussi le nombre de mesures synced=false, l'âge de la plus ancienne mesure en attente et le lag de consolidation.

Les statuts ont la signification suivante :

ok : dépendances disponibles et synchronisation dans le seuil attendu ;

degraded : le backend reste partiellement fonctionnel, mais MQTT, PostgreSQL ou la synchronisation sont indisponibles ou en retard ;

down : MongoDB ou Redis, nécessaires au fonctionnement du pipeline, sont indisponibles.

Une synchronisation dont le plus ancien document en attente dépasse SYNC_LAG_THRESHOLD_MS (300 secondes par défaut) est signalée blocked.

Ainsi, « opérationnel » signifie désormais que le niveau de service réel est explicitement connu, et non simplement que le processus Express répond.
