# Engine versions and the features they gate

A recommendation that needs a feature the target database does not have is a wrong finding. Before suggesting syntax or a setting, find which database the code talks to, then check this table.

Snapshot taken 2026-11-06. Aurora Postgres and ElastiCache from Datadog (`avg:aws.rds.cpuutilization by {dbinstanceidentifier,engineversion}`, `avg:aws.elasticache.cpuutilization by {cacheclusterid,engine,engine_version}`, last 24 h). ClickHouse Cloud services from `chctl cloud service list`; ClickHouse Cloud managed Postgres from `chctl cloud postgres list` and `SELECT version()` through `chctl cloud postgres query --name <service>`. Local versions from `docker-compose.yml`; CI from `.circleci/config.yml`. Versions move: re-run those commands when a finding depends on a version boundary, and update this file.

Datadog is not the whole picture. A decommissioned Aurora cluster keeps emitting metrics (`terracotta-cluster-production` still reports 17.9 a month after Terracotta moved off it), and managed Postgres has no `aws.rds.*` metrics at all. Confirm which host a service connects to from its `AGENTS.md` or the `*_DATABASE_URL` owner before trusting a Datadog version tag.

## Postgres

| Database                                     | Production                            | Local / CI                                  | Lowest version you may assume |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------- |
| Main `clay` (apps/api, `clay_admin` schema)  | 14.20 (`clay-production-db`)          | 14.5 (`postgres`, port 5433) / CI 16.2      | **14**                        |
| Sharded `clay_shards` (Aurora PostgreSQL Limitless Database, shard key `workspace_id`) | not tagged in Datadog | 16.4 (`postgres-sharded`, 5434), a plain Postgres that does not emulate Limitless routing | 16 (verify before relying on it) |
| Terracotta (ClickHouse Cloud managed Postgres `terracotta-pg-prod`, async HA, i8ge.6xlarge; moved from Aurora 2026-10-01) | **18.6** (`SELECT version()`, 2026-11-06) | 17 (`postgres-terracotta`, 5435); CI **16.2** (`node-and-db-and-redis-and-clickhouse` executor) | **16**: CI is the floor, so 17 and 18 syntax stays out of migrations and queries; 18 runtime behavior (skip scan, async I/O) applies in production only |
| `agents` schema (same `terracotta-pg-prod` database)              | 18.6                                  | 17 (`postgres-terracotta`, 5435); CI 16.2   | 16                            |
| Reps (ClickHouse Cloud managed Postgres `reps-pg-prod`, created 2026-10-26) | **18.6** | 14.5 (`reps` database on the main `postgres` container, 5433); CI 16.2 | **14**: local is the floor, two majors below CI and four below production |
| GTM agent                                    | 17.4 / 17.9 (mid-upgrade)             | 17 (`postgres-gtm-agent`, 5436)             | 17                            |
| Entity data ingestion                        | 17.9                                  | n/a                                         | 17                            |
| Scheduler, trigger-event-monitor, url-shortener | 16.11                              | url-shortener 15 locally                    | 16                            |
| `entities-data-db`                           | 15.15                                 | n/a                                         | 15                            |
| `urltypeservice-production`                  | 11.21 (end of life)                   | n/a                                         | 11                            |

Every CI job that needs Postgres runs `cimg/postgres:16.2` (there is no 17 image in `.circleci/config.yml`): main, sharded, Terracotta, `agents`, GTM agent, scheduler, reps. **A main-database or reps migration that passes CI can still fail locally on 14, and for the main database in production.** Using a feature from the 15+ rows below in a main-database migration or query is a P1; a 17+ feature in a Terracotta, `agents`, or GTM-agent migration fails CI.

### Feature gates that come up in reviews

| Feature                                                                             | Since | 14 (main, reps local) | 16 (scheduler, TEM, url-shortener; CI for everything) | 17 (GTM agent, entity ingestion; Terracotta local) | 18.6 (Terracotta, Reps production) |
| ----------------------------------------------------------------------------------- | ----- | ------------ | ------ | ------ | ------ |
| `ADD COLUMN … DEFAULT <non-volatile>` without a rewrite                             | 11    | yes          | yes    | yes    | yes    |
| `SET NOT NULL` skips the scan when a validated `CHECK (col IS NOT NULL)` exists     | 12    | yes          | yes    | yes    | yes    |
| `REINDEX CONCURRENTLY`, stored generated columns                                    | 12    | yes          | yes    | yes    | yes    |
| B-tree deduplication, incremental sort                                              | 13    | yes          | yes    | yes    | yes    |
| `DETACH PARTITION … CONCURRENTLY`, `idle_session_timeout`, LZ4 TOAST, Memoize, multiranges, jsonb subscripting | 14 | yes | yes | yes | yes |
| `MERGE`                                                                             | 15    | **no**       | yes    | yes    | yes    |
| `UNIQUE NULLS NOT DISTINCT`                                                         | 15    | **no**       | yes    | yes    | yes    |
| `CREATE` on `public` revoked from `PUBLIC` in new databases                         | 15    | old default  | new    | new    | new    |
| `ANY_VALUE()`, SQL/JSON constructors (`JSON_ARRAY`, `JSON_OBJECT`), `IS JSON`, `pg_stat_io` | 16 | **no** | yes | yes | yes |
| `JSON_TABLE`, `JSON_EXISTS`/`JSON_QUERY`/`JSON_VALUE`, `MERGE … RETURNING`, `WHEN NOT MATCHED BY SOURCE`, `EXPLAIN (SERIALIZE, MEMORY)`, `COPY … ON_ERROR ignore`, faster B-tree `= ANY(array)` scans, lower-memory vacuum | 17 | **no** | **no** | yes | yes |
| `uuidv7()`, virtual generated columns, B-tree skip scan, `RETURNING OLD/NEW`, async I/O (`io_method`), `NOT NULL … NOT VALID`, `autovacuum_vacuum_max_threshold` | 18 | **no** | **no** | **no** | yes in production, **no** locally or in CI |

Consequences reviewers keep relearning:

- On the main database, "insert or update" is `INSERT … ON CONFLICT`, not `MERGE`. A unique constraint over nullable columns treats NULLs as distinct; enforce uniqueness with a partial unique index (`WHERE col IS NULL` / `IS NOT NULL` pair) or a unique index on `COALESCE(col, <sentinel>)`.
- UUIDv7 keys are generated in the application. `uuidv7()` exists on Terracotta and Reps production but not on their local or CI databases, so a migration or default that calls it fails before it reaches production.
- Terracotta migrations are written for 16 (CI floor; local is 17), Reps for 14 (local floor), and both run on 18.6. Runtime-only 18 features (skip scan on multicolumn B-trees, `io_method = worker`) change plans in production without changing what you may write; test plans on production-shaped data, not on local 17.
- Prefer a syntax that works on 14 in shared libraries (`libs/shared-backend`) unless the library is pinned to one database.

### Aurora-specific behavior (main, sharded, GTM agent, scheduler, trigger-event-monitor, entity ingestion, url-shortener)

- Readers share storage with the writer. A reader query that conflicts with WAL replay (vacuum removing rows its snapshot needs, an `ACCESS EXCLUSIVE` lock from DDL such as `DROP INDEX`) is cancelled after `max_standby_streaming_delay`, which Aurora caps at 30 s ([AWS: Manage long-running read queries on Aurora PostgreSQL](https://aws.amazon.com/blogs/database/manage-long-running-read-queries-on-amazon-aurora-postgresql-compatible-edition/)). Long reports on an Aurora reader are fragile; they belong in ClickHouse.
- DDL on the writer can cancel in-flight reader queries for the same reason. Schedule heavy DDL with that in mind and say so in the PR.

### ClickHouse Cloud managed Postgres (Terracotta, Reps)

Settings read from `terracotta-pg-prod` on 2026-11-06 (`pg_settings`):

- `lock_timeout`, `statement_timeout`, and `idle_in_transaction_session_timeout` are all **0** (unbounded) at the server level. The application role `terracotta_service` carries `lock_timeout=10s` as a role default (`pg_roles.rolconfig`; `libs/terracotta/src/prisma.ts` explains why it is not a connection option: PgBouncer rejects startup `options`). Any other role, including whatever the migrate task connects as, gets the server default of 0. This skill's rule, not yet a repo rule: every Terracotta DDL migration carries `SET LOCAL lock_timeout` (precedents `20260910190000_drop_trigger_fired_columns_from_runs`, `20260918120000_drop_context_droplets`; most older migrations do not).
- `max_connections` 500; `synchronous_commit` on; `wal_level` logical (the ClickHouse replica `public_tc_*` is fed by logical replication, so every write is also replication work); `hot_standby_feedback` on and `max_standby_streaming_delay` 30 s for the async HA standby; `io_method` worker; `autovacuum_vacuum_max_threshold` 50M rows.
- Datadog has no host metrics for these services (`services/terracotta-service/docs/snapshot-script-code-backfill.md`). Use `chctl cloud postgres metrics`, `slow-queries`, and `logs`, or SQL on `pg_stat_*`.
- Capacity figures from before 2026-10-01 describe Aurora, not this service (`services/terracotta-service/AGENTS.md`); re-measure before quoting a ceiling.

## ClickHouse (ClickHouse Cloud, SharedMergeTree)

| Service                                                         | Version | Channel |
| --------------------------------------------------------------- | ------- | ------- |
| Audiences - PROD                                                | 26.2    | default |
| CPJ - PROD, CPJ services, terracotta-production, Credit Reporting - PROD, Audit Logs - PROD, Subroutines Observability - PROD | 26.4 | default |
| ClayQL-Production, ClayQL-Staging, Prospector - PROD (stopped) | 26.6    | default |
| Every other `- Staging` service, Observability                  | 26.8    | fast    |
| Local `docker-compose.yml` / CI                                 | 26.2 / 26.2 and 26.4 | n/a |

Staging runs the fast channel, two to six minor versions ahead of production. **A query that works on staging can fail on Audiences - PROD (26.2).** Assume 26.2 unless the code only talks to one service.

Feature tiers on 26.2, from `system.settings` on Audiences - PROD (2026-11-06). Tiers are engine facts. Values are per profile: the `sql-console` profile `chctl` uses overrides several engine defaults (`changed = 1`), and the application's user has its own profile. **Before relying on a setting's value, read it as the application user**, or ask the service owner; the engine default tells you what an unconfigured profile gets.

| Feature                                                               | Setting                                       | Tier on 26.2               | Engine default | `sql-console` value |
| --------------------------------------------------------------------- | --------------------------------------------- | -------------------------- | -------------- | ------------------- |
| `JSON`, `Variant`, `Dynamic` types                                    | `enable_json_type` etc.                       | GA (flag obsolete)         | on             | on                  |
| Refreshable materialized views                                        | `allow_experimental_refreshable_materialized_view` | GA (flag obsolete)    | on             | on                  |
| Vector similarity index                                               | `allow_experimental_vector_similarity_index`  | GA (flag obsolete)         | n/a            | n/a                 |
| Full-text (`text`) index                                              | `enable_full_text_index`                      | Production                 | on             | on                  |
| New analyzer                                                          | `enable_analyzer`                             | Production                 | on             | on                  |
| Lightweight `DELETE`                                                  | `lightweight_deletes_sync`                    | Production                 | sync           | sync                |
| Lightweight `UPDATE` (patch parts)                                    | `enable_lightweight_update`                   | **Beta**                   | on             | **off**             |
| Column statistics for the optimizer                                   | `use_statistics` / `allow_statistics_optimize` | Beta / Beta               | on / on        | on / **off**        |
| Parallel replicas                                                     | `enable_parallel_replicas`                    | Production                 | off            | off                 |
| Async inserts                                                         | `async_insert` (`wait_for_async_insert`)      | Production                 | on (on)        | **off** (on)        |
| Skip indexes used under `FINAL` / on data read                        | `use_skip_indexes_if_final`, `use_skip_indexes_on_data_read` | Production  | on / on        | **off** / **off**   |
| Query condition cache, lazy materialization, automatic join side swap | `use_query_condition_cache`, `query_plan_optimize_lazy_materialization`, `query_plan_join_swap_table` | Production | on / on / auto | on / on / auto |

Re-check with:

```sql
SELECT version(), name, value, default, changed, tier FROM system.settings WHERE name IN (…)
```

through `chctl cloud service query --org-id <org> --name "Audiences - PROD" --no-auto-enable --json -q "<sql>"` (OAuth login via `chctl cloud auth login`; read-only).

## Redis and Valkey (ElastiCache)

| Engine        | Clusters (production unless noted)                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Valkey 8.1.0  | `terracotta-production-bullmq-*`, `terracotta-staging-bullmq-*`                                                         |
| Valkey 8.0.1  | ai-runner (redis, task-queue-bull-mq, task-checkpoints, gtm-agent), api action-result-cache, action-task-polling, rate-limits, run-status-cache, record-lookup-index, stuck-cell-detector, notification-limiter, async-callback-timeouts, entity-resolution, fair-queue, reps, clayql-sync, switchboard (staging) |
| Redis OSS 7.1 | `api-production-bullmq-*`, `api-production-rts-relay`, `api-production-credit-cache`, `scheduler-production-redis`, `audiences-production-redis-rg-*`, `website-sesh-monitor-*` |
| Redis OSS 7.0.7 | `clay-redis-prod-2023-*` (the busiest node, ~61% CPU on the day of the snapshot)                                     |
| Local         | Valkey 8.0.9 (`redis`, port 6381), Redis 7.0.7 (`flow_engine_redis`, 6380); CI Valkey 8.0.1                             |

Feature gates:

| Feature                                                          | Available on                      | Not on                        |
| ---------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| Functions (`FUNCTION LOAD`/`FCALL`), sharded pub/sub (`SPUBLISH`), `EXPIRE … NX/XX/GT/LT`, `LMPOP`/`ZMPOP` | Redis 7.0+, Valkey 8 | — |
| `WAITAOF`                                                        | Valkey 8 (forked from Redis 7.2)  | Redis OSS 7.0 / 7.1           |
| Hash field TTL (`HEXPIRE` Redis 7.4+ / Valkey 9.0+; `HGETEX`/`HSETEX` Redis 8.0+ / Valkey 9.0+, [release](https://valkey.io/download/9.0/)) | Valkey 9.0+, Redis 7.4+/8.0+ | **every cluster here** |
| Numbered databases in cluster mode, atomic slot migration        | Valkey 9.0+                       | every cluster here            |
| Search / JSON modules (Redis Stack)                              | not on these ElastiCache engines  | every cluster here            |

A design that needs per-field expiry uses one key per field with its own TTL, or a sorted set of expiry times swept by a job, until the cluster moves to Valkey 9.

## Other engines in the repo

`docker-compose.yml` also runs Vitess (`vttestserver:mysql80`), the Audiences source of truth (`services/audiences/mysql/migrations/`, vschemas in `mysql/keyspaces/*/vschema.json`), plus OpenSearch 2.19 and Elasticsearch 8.14. This skill does not cover their engine rules. For Vitess, defer to `services/audiences/AGENTS.md`, `clay-audiences`, and `audiences-platform-review`; the cross-engine sections of this skill (source of truth, expand/contract, deploy order) still apply.
