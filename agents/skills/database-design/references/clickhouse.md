# ClickHouse schemas, ingestion, and queries

Sources: "ClickHouse – Lightning Fast Analytics for Everyone" (VLDB 2024), ClickHouse docs "Best practices", DDIA 2e "Storage and Retrieval" (column-oriented storage) and "Stream Processing" (derived data), Database Internals (LSM trees). Rule-level detail lives in the repo skills: **load `clickhouse-best-practices` for any ClickHouse schema or query and `clickhouse-architecture-advisor` for ingestion, enrichment, late-arriving upserts, or pre-aggregation design.** This file adds what those skills do not: version gates on our services, repo precedent, and the cross-engine questions (what is the source of truth, how does the copy stay correct).

Repo rules: `services/audiences/AGENTS.md`, `services/terracotta-service/AGENTS.md`, `services/clayql-sync/clickhouse/migrations/README.md`, `clay-search-dsl` skill.

The one-line version: **ClickHouse is an append-mostly read model whose correctness comes from the sort key and the merge engine.** Every schema review asks: what is the source of truth, how are duplicates and deletes collapsed, and what does a query see before the merge happens.

## Where ClickHouse schema lives and how it ships

| Area | Migrations | Applied | CI check |
| --- | --- | --- | --- |
| Terracotta | `services/terracotta-service/clickhouse/migrations/`; local-only stand-ins for replication-owned schema in `migrations-dev/` (never applied to staging/prod) | Auto-applied staging then prod on dev merge (`terracotta-clickhouse-migrate.yml`; failures post to `#workflow-team-alerts`, rerun by `workflow_dispatch` from `dev`) | `terracotta-clickhouse-migration-check.yml`: applied files immutable, filename format, no `Shared*` engines |
| data-platform | `data-platform/infrastructure/database/clickhouse/migrations/NNNN_*.sql` | `clickhouse_migrate.yml` on merge | `clickhouse_migration_check.yml`: duplicate numbers, no `Shared*` engines |
| Audiences | `services/audiences/clickhouse/migrations*/` | **By hand**, often before merge | none |
| ClayQL sync | `services/clayql-sync/clickhouse/migrations/` | ECS task before deploy | none |
| Credit usage | `apps/api/v3/billing/clickhouse/migrations/` | By hand (file headers) | none |

Runner: `libs/shared-backend/src/clickhouse/migration-utils.ts`. It applies files in filename order, records a file in `_migrations` (content-hashed) only after its last statement succeeds, and stops at the first failure, so one failing file also blocks every later file in the directory until it is fixed and rerun; a rerun repeats the statements that already succeeded, which is why every statement must be idempotent. Migrations are forward-only, idempotent (`IF NOT EXISTS`), and expand-only; an applied file is never edited. Never write `SharedMergeTree`: Cloud substitutes it for `MergeTree` families.

In the Check column, "Review" means no automation exists: the check is a reviewer reading the diff, so write `(unenforced)` in a finding.

## 1. The sort key is the index

VLDB paper, storage layer (sparse primary index, granules); `clickhouse-best-practices` schema rules.

| Smell | Move | Check |
| --- | --- | --- |
| `ORDER BY` chosen by habit (`id`, `created_at`) rather than by the filters the readers use | Lead with the columns every query filters on, low cardinality first (`workspace_id`, then entity type, then time or id). A query that does not filter on the prefix reads every granule | `EXPLAIN indexes = 1` shows granules selected / total |
| A second access pattern that does not share the sort prefix | Projection or a second table fed by a materialized view, not a skip index on the wrong table | `EXPLAIN indexes = 1` |
| Changing `ORDER BY` on an existing table | Only appending a column added in the same `ALTER` is allowed. Otherwise: new table, `INSERT … SELECT`, `EXCHANGE TABLES`; the search-dsl tables promote by swap the same way | Review |
| Skip index (`bloom_filter`, `set`, `minmax`) on a column uncorrelated with the sort key | It skips nothing and costs every insert and merge. Check the skip ratio before keeping it | `EXPLAIN indexes = 1` |
| Skip index expected to help a `FINAL` query | `use_skip_indexes_if_final` defaults on in the engine but is off in the `sql-console` profile on Audiences - PROD; read it as the application user before assuming either (`versions.md`) | `system.settings` with `changed` |

## 2. Partitioning is for data lifecycle, not speed

| Smell | Move | Check |
| --- | --- | --- |
| `PARTITION BY` a high-cardinality key (workspace, entity id) or by day on a long-lived table | Thousands of partitions mean thousands of small parts and slow merges. Partition by month or by a small hash bucket; use partitions to `DROP` or `TTL` old data | `system.parts` count per table |
| Time partition on a `ReplacingMergeTree` CDC table | Versions of one row land in different partitions and never collapse. CDC current-state tables are hash-partitioned `cityHash64(key) % N` | Precedent and rationale: `data-platform/.../migrations/0124_clickpipe_cdc_invert_landing_to_rmt.sql` |

## 3. Duplicates, updates, and deletes are merge-time and eventual

VLDB paper, merge-time data transformation; `clickhouse-architecture-advisor` late-arriving upserts.

| Smell | Move | Check |
| --- | --- | --- |
| Reader of a `ReplacingMergeTree` that assumes one row per key | Rows collapse only when parts merge, which may be never. Dedupe at read time: `FINAL`, or `argMax(col, version) … GROUP BY key`, and filter tombstones (`_peerdb_is_deleted = 0`) | Test inserting two versions of one key; precedents in Terracotta and data-platform readers |
| `FINAL` on the search-dsl `*_query_latest` tables | Those are rebuilt by refreshable MVs and promoted by swap; `FINAL` is wasted work there | `clay-search-dsl` rule |
| CDC replica tables (Terracotta `public_tc_*` with `_lsn`/`_is_deleted`; ClickPipes/PeerDB landing tables with `_peerdb_*`) created or altered in a migration | Replication owns them. A new Postgres column must be visible on the replica before any ClickHouse view or service query names it: a view referencing a missing column fails to attach, a service query fails with `UNKNOWN_IDENTIFIER`. Terracotta states this as a **MERGE GATE** in the migration header (precedent `20260923000000_add-starting-node-id-to-runs-projection.sql`; the convention lives in those headers, `AGENTS.md` only says never create or alter `public_tc_*`); verify with `system.columns` on staging and prod before merge and paste the result in the PR. A service query that reads the new column ships after that, or in a later PR | `services/terracotta-service/AGENTS.md`, `services/audiences/AGENTS.md`; the gate itself is `(unenforced)` |
| Application code issuing `ALTER TABLE … UPDATE/DELETE` (mutations) per entity | Mutations rewrite whole parts; per-entity mutations on large tables have failed in production. Insert a new version (Replacing) or a tombstone; lightweight `DELETE` for rare cleanups | `services/audiences/AGENTS.md` |
| Lightweight `UPDATE` proposed | Beta tier on 26.2; engine default on, off in the `sql-console` profile (`versions.md`). A Beta feature is not a design dependency; confirm the application profile before relying on it | `system.settings` tier |
| Deleting from or altering the Terracotta archive table `archive_tc_workflow_run_steps` | It is the only copy of deleted step rows; its DDL `COMMENT` says never delete, alter, or drop it | `services/terracotta-service/src/domain/__tests__/step-archive.test.ts` (migrations may only grow the archive) |

Recorded decisions override these rows. Some readers skip read-time dedupe on purpose and mark it with a linked comment, for example `[##]NoFinalOnCreditUsageReads` in `libs/shared-backend/src/credit-usage/clickhouse.service.ts`: aggregates tolerate the drift. Before filing a dedupe finding, grep for a `[##]`/`[#]` marker on the reader; if one exists, the finding is only valid when the diff changes what the marker assumed.

## 4. Inserts: few and large

| Smell | Move | Check |
| --- | --- | --- |
| Insert per event / per row from a request path | Each insert creates a part; small inserts cause "too many parts" and merge backlog. Batch (thousands of rows or seconds of data), route through Kafka/ClickPipes, or `async_insert` with `wait_for_async_insert = 1` (engine default on; the `sql-console` profile turns it off, so check the application profile) | `system.parts`, `system.part_log` insert rate |
| Retried insert without a dedup token | A retry duplicates the batch in plain `MergeTree`. Make the batch deterministic and use `insert_deduplication_token`, or land in a Replacing table | Test |

## 5. Materialized views

VLDB paper, materialized views; `clickhouse-best-practices` MV rules.

| Smell | Move | Check |
| --- | --- | --- |
| Incremental MV that aggregates and expects to see the merged table | An incremental MV is an insert trigger: it sees only the inserted block. Target an `AggregatingMergeTree` with `-State` columns and read with `-Merge`, or use a refreshable MV | Precedent: Terracotta `20261012171458_create-latest-record-runs-v2.sql` (`AggregatingMergeTree`; v1 was dropped by `20261012193058`) |
| Incremental MV with a `JOIN` | Fires only on inserts to the left table; changes to the right side never propagate. Dictionary lookup or refreshable MV | Review |
| Refreshable MV (`REFRESH EVERY …`) over a large source with no bound | Each refresh recomputes the full query. Bound the window, `APPEND` mode, `RANDOMIZE FOR` to spread load | Precedents: `services/audiences/clickhouse/migrations/20260601000001_create_workspace_counts.sql`, data-platform `0040` |

## 6. Queries

| Smell | Move | Check |
| --- | --- | --- |
| `LIMIT` relied on to bound cost | `LIMIT` stops output, not the scan or the aggregation. Bound with the sort-key prefix and a time range; set `max_execution_time` / `max_rows_to_read` on user-facing queries | `EXPLAIN ESTIMATE` |
| Large right side in a `JOIN` | The right side is built in memory. The 26.x analyzer swaps sides automatically (`query_plan_join_swap_table = auto`), but a dimension lookup is a dictionary or `IN (subquery)` | `EXPLAIN` |
| `uniqExact` / `count(DISTINCT)` on a dashboard | `uniq` / `uniqCombined` unless the exact number is the product | Review |
| Read-after-write against ClickHouse (write to Postgres, then read ClickHouse expecting the row) | CDC lag is seconds to minutes. Overlay the primary for recent rows, or carry the value forward; `DATABASE.md` "Query discipline" | Test with a stale replica |
| SQL built with string interpolation | `chsql` from `@clay-run/shared/src/clickhouse/chsql`; identifiers through `chsql.identifier(...)` (`libs/shared/src/clickhouse/chsql.ts`) | Review |
| Entity table names hard-coded in Audiences | `src/db/repositories/clickhouse/entity-table-names.ts` | `services/audiences/AGENTS.md` |

## 7. Types

`JSON`, `Variant`, and `Dynamic` are GA on every service (`versions.md`). Use `LowCardinality(String)` for strings with up to tens of thousands of distinct values; avoid `Nullable` unless NULL means something different from the default (it adds a null map per column; a NULL that drives a `coalesce` fallback for rows written before a column existed is a valid reason); `DateTime64(3)` only when sub-second precision is real; codecs (`Delta`, `DoubleDelta`, `ZSTD`) on monotonic and numeric columns. Detail: `clickhouse-best-practices` schema rules.

Changing a projection column to `MATERIALIZED` (`ALTER TABLE … MODIFY COLUMN … MATERIALIZED expr`) is metadata-only: existing parts keep their stored values and only new inserts use the new expression. Precedent: Terracotta `20261001120000_read-typed-columns-in-managed-projections.sql`. `MODIFY QUERY` on an MV replaces the whole `SELECT`, so MV migrations are not commutative: each must repeat every column earlier ones added.

## What to write in the PR

For a new ClickHouse table: the source of truth and how rows arrive (ClickPipes, Kafka, application batch), the engine and how duplicates/deletes collapse, the sort key and the query shapes it serves (with `EXPLAIN indexes = 1` granule counts), partition key and expected partition count, and which service and version it targets.

Sizing through `chctl` (Query API, ~30 s gateway timeout; the query may keep running server-side): take row counts and bytes from `system.tables` (`total_rows`, `total_bytes`) and `system.parts`, not `count()` over a large table; bound ad-hoc counts to one partition or one day; check the version with `SELECT version()` on the target service.
