# Décisions prises au cours du projet

## Décisions prises J2

### Double base de données : MongoDB + PostgreSQL

On a choisi de doubler notre base de données. Nous avons ajouté une base de données non relationnelle : **MongoDB 7**, qui reçoit l'ensemble des messages de télémétrie dès leur arrivée via MQTT. Ensuite, nous avons conservé **PostgreSQL 16** comme source de vérité pour les lectures : elle ne contient que des données validées et sans doublons métier.

**Chemin d'écriture :**

1. Le message est validé (champs obligatoires, types numériques).
2. La déduplication est effectuée dans MongoDB via un index unique sur `message_id` et l'opération `$setOnInsert` : un message rejoué n'est jamais inséré deux fois.
3. Le message est sauvegardé dans MongoDB avec le flag `synced: false`.
4. Un lot de synchronisation (maximum 500 messages, toutes les 5 secondes) transfère les messages non synchronisés de MongoDB vers PostgreSQL. L'insertion dans PostgreSQL utilise `ON CONFLICT (message_id) DO NOTHING` comme filet de sécurité supplémentaire.

**Chemin de lecture :**
L'API expose un `FallbackMeasurementRepository` : les requêtes lisent PostgreSQL en priorité. Si PostgreSQL est indisponible, la lecture bascule automatiquement sur MongoDB. Cela garantit la disponibilité de l'API même en cas de panne de la base principale.

**Pourquoi ce découplage ?**

- Limiter les appels réseau directs vers PostgreSQL lors des pics d'ingestion.
- Éviter qu'une indisponibilité de PostgreSQL ne bloque la réception des mesures.
- Disposer d'un journal complet de tous les messages bruts dans MongoDB, y compris les doublons rejetés.

### Problèmes identifiés sous charge — pistes de correction

Pendant les tests de stress (1000 messages + 250 doublons), on a découvert trois problèmes.

---

**Problème 1 — Perte silencieuse de messages **

Le client MQTT a une file d'attente limitée à 100 messages. Quand on depasse cette limite, les messages suivants ne s'envoient pas. Nous n'avons pas de messages d'alertes pour dire que des messages disparaissent. Nous perdons donc des donnees sans etre au courant.

Il faudrait ajouter un outil comme Redis, qui gere la file d'attente pour que le backend puisse la traiter a son rythme.

---

**Problème 2 — Plafond de débit : 100 messages/seconde**

Actuellement, nous avons deux ecritures de chaque message : une premiere sur MongoDB et ensuite sur PostgreSQL avec une synchronisation toutes les 5 secondes des messages de mongoDB sur PostgreSQL. Lorsqu'il y a beaucoup de messages, il faut un minimum de temps avec que l'ensemble des donnees soient visibles dans l'API.

---

**Problème 3 — L'API cache l'état réel du pipeline**

`GET /history` retourne maximum 50 lignes. On ne peut pas savoir depuis l'extérieur combien de messages sont en attente dans MongoDB, si la synchronisation est à jour, ou si on a perdu des données.

**Ce qu'il faudrait faire :**
Il faudrait ajouter un endpoint avec l'ensemble des messages qu'il reste a synchroniser.

---

### Cache persistant côté mobile

TanStack Query v5 est configuré avec `networkMode: 'offlineFirst'` et un `gcTime` de 24 heures. Les données sont persistées sur le disque de l'appareil via `@tanstack/react-query-persist-client` et `AsyncStorage`. En cas de perte de réseau, l'application affiche les dernières données connues avec un bandeau « Mode hors ligne » plutôt qu'un écran d'erreur vide.

## Décisions prises J3

### Choix d'architecture : suivi des événements et rejets (Arbitrage PostgreSQL vs. Loki + Promtail)

**Problématique :**
Pour analyser et afficher les événements système ainsi que les rejets (payloads invalides, doublons, erreurs de validation) dans Grafana, deux approches d'architecture étaient envisageables :

- **Option A (PostgreSQL direct) :** Faire enregistrer par le backend les événements rejetés directement dans une table dédiée (`rejected_events`) de la base PostgreSQL.
- **Option B (Loki + Promtail) :** Centraliser les flux de logs émis par le backend vers Loki via Promtail.

---

#### 1. Premier choix : Stockage direct des rejets dans PostgreSQL (Option A)

Dans un premier temps, nous avons choisi d'**écarter Loki et Promtail** afin de ne pas complexifier l'infrastructure Docker avec deux conteneurs supplémentaires (`loki` et `promtail`) et des configurations de parsing associées.

---

#### 2. Révision de la décision : Réintégration de Loki et Promtail (Option B)

Lorsque nous avons dû implémenter la recherche et le suivi avancé de l'ensemble des événements, nous sommes revenus sur notre choix initial pour adopter la stack **Loki + Promtail**.

**Pourquoi l'Option A (PostgreSQL) s'est avérée inappropriée :**

- **Pollution du domaine métier :** Ajouter des tables d'infrastructure/logs (`rejected_events`, `duplicate_events`) aurait pollué la base métier PostgreSQL en mélangeant des données métier avec des métadonnées système (`level`, `service`, `eventType`).
- **Maintenance et évolution lourdes :** Chaque nouveau type d'événement (erreurs MQTT, alertes d'obsolescence, reconnexions) aurait nécessité de créer de nouvelles tables ou de faire évoluer les schémas SQL.
- **Duplication d'écriture :** Le backend écrivait déjà ces informations sur `stdout`. Les réécrire en BDD créait une double écriture et augmentait la surface de panne.

**Pourquoi l'Option B (Loki + Promtail) est la solution adaptée :**

- **Zéro modification backend :** Le backend émettant déjà toutes ses traces au format JSON structuré sur `stdout`, aucune modification de code supplémentaire n'a été nécessaire.
- **Surface de recherche unifiée :** Loki offre un point d'accès centralisé dans Grafana pour requêter facilement tous les types d'événements (présents et futurs) via LogQL.
- **Outil fait pour cet usage :** Loki est conçu spécifiquement pour la gestion des séries temporelles et des logs (_append-only_, rétention/TTL, compaction efficiente), contrairement à une base relationnelle.
