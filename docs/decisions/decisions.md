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

