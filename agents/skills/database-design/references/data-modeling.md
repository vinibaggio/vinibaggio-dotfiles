# Data modeling and choosing the store

Sources: DDIA 2e ("Data Models and Query Languages", "Storage and Retrieval", "Encoding and Evolution", "Sharding", "Stream Processing"), SQL Antipatterns Vol. 1 (Karwin), Refactoring Databases (Ambler & Sadalage). This is the reference for design discussions before any code exists: where a new piece of data lives, what shape it takes, and how it evolves.

The one-line version: **pick the store by the access pattern and the consistency promise, then model for the query you will run most often at the size it will reach.**

## 1. Which store owns the data

DDIA 2e "Trade-offs in Data Systems Architecture" (systems of record vs derived data).

| The data is… | Store | Not |
| --- | --- | --- |
| A fact the user was promised (a row they edit, money, permissions, workflow state) | Postgres: the database that owns that domain (main, Terracotta, GTM agent, scheduler) | Redis (failover loses writes), ClickHouse (eventual, merge-time dedupe) |
| Tenant record data at the scale of the `records` tables, keyed by workspace | Sharded Postgres (Aurora Limitless, `workspace_id` shard key), Knex only; template in `apps/api/v3/tables/models/table-record.model.ts` | Main database |
| Audiences entities and commands | Vitess (source of truth) with ClickHouse as the read model; follow `clay-audiences` and `audiences-data-modeling-review` | Postgres |
| Lists, counts, search, dashboards, health over many rows; anything the user does not edit in place | ClickHouse, fed by CDC (PeerDB/ClickPipes, or the managed Postgres's own logical replication) or Kafka | Postgres readers (Aurora readers cancel conflicting queries after 30 s, `versions.md`; the Terracotta primary has no reader at all, so a long report runs on the writer) |
| Ephemeral or rebuildable state: caches, rate-limit buckets, dedupe windows, presence, progress | Redis/Valkey with a TTL (`redis-valkey.md` §5) | Postgres when the update rate is high (one row version per update, vacuum churn on one hot row). A low-rate daily cap in Postgres is accepted precedent: `apps/api/v3/ai/models/cpj-search-usage.model.ts`. State the rate either way |
| Work to be done later, with retries | BullMQ on a `noeviction` cluster, or a Postgres row claimed with `SKIP LOCKED` when the job must be transactional with the write that creates it | Pub/sub |
| Large blobs (payloads, documents, files) | S3 with a pointer row; or the Terracotta payload archive in ClickHouse where that pattern exists | `jsonb`/`text` columns over a few hundred KB |

A design that writes the same fact to two stores names which one is authoritative and how the other is rebuilt (`software-design` "Derived data must declare its source of truth").

## 2. Model for the dominant query

| Smell | Move | Check |
| --- | --- | --- |
| Entity-Attribute-Value table (`entity_id, key, value`) for user-defined fields (Karwin "Entity-Attribute-Value") | Typed columns for known fields; one `jsonb` column for truly open-ended attributes with expression indexes on the keys you filter on | Review |
| Polymorphic association: `target_type` + `target_id` with no FK (Karwin "Polymorphic Associations") | One nullable FK column per target type with a `CHECK` that exactly one is set, or a shared supertype table | Review |
| Comma-separated ids in a column, or an array of ids used as a relation (Karwin "Jaywalking") | Join table, unless the list is always read and written whole and never queried by element | Review |
| Status, settings, and relations packed into one `jsonb` blob | Columns for anything filtered, sorted, joined, or updated on its own; `jsonb` for the rest. Spread-merge updates | `DATABASE.md` |
| Tree stored as `parent_id` only, queried for whole subtrees on a hot path (Karwin "Naive Trees") | Recursive CTE is fine at small depth; materialized path or closure table when subtree reads dominate | `EXPLAIN` at production depth |
| A table that will reach 10⁸+ rows with no plan for retention | Decide now: partition by time and drop, archive to ClickHouse/S3, or TTL. Retrofitting partitioning onto a hot table is a multi-week migration | PR states growth rate and retention |
| Same data modeled differently in Postgres and ClickHouse with no mapping | Name the CDC mapping (ClickPipe), the dedupe key, and the tombstone column | `clickhouse.md` §3 |

## 3. Tenancy

Every tenant-owned row carries `workspace_id`; it leads the primary or the main index, scopes every query, and is the shard key where the data is sharded (DDIA 2e "Sharding for Multitenancy"). A design that omits it from a new tenant table, or keys a Redis key family without it, is a finding: it breaks isolation, per-tenant deletion, and later sharding.

## 4. Evolution is part of the model

DDIA 2e "Encoding and Evolution"; Refactoring Databases.

- Every schema change is planned as expand → migrate → contract (`postgres-migrations.md` §2). A design doc names the steps and the releases.
- Serialized payloads (queue jobs, `jsonb` documents, Kafka messages, ClickHouse JSON) need forward and backward compatibility: producers add optional fields before consumers require them; consumers ignore unknown fields. The root `AGENTS.md` deploy-order rule applies to queue producers and consumers.
- A field the `clay` CLI reads cannot be removed or narrowed without the `ROLLOUT.md` release sequence.

## 5. Size it before you build it

Production numbers decide most of these questions. Read-only Datadog and ClickHouse queries are pre-approved: get the current row count and write rate of the tables involved (Aurora: Datadog `postgresql.*` / `aws.rds.*` metrics; Terracotta and Reps: `chctl cloud postgres query` against `pg_stat_user_tables` and `chctl cloud postgres metrics`, since Datadog has no host metrics for them; ClickHouse: `system.parts`/`system.tables`), and put the numbers and the query in the design. "Should be fine" is not a size.
