# Postgres schema changes and migrations

Sources: Refactoring Databases (expand/contract), PostgreSQL 14 Internals ("Relation-Level Locks", "Rebuilding Tables and Indexes"), High Performance PostgreSQL for Rails (migration safety), PostgreSQL Mistakes and How to Avoid Them, the versioned "Explicit Locking" and `ALTER TABLE` docs. Repo rules: `apps/api/code-agents/DATABASE.md`, `apps/api/code-agents/ROLLOUT.md`, `apps/api/scripts/AGENTS.md`, `services/terracotta-service/AGENTS.md`, `libs/terracotta/AGENTS.md`, `libs/gtm-agent-db/README.md`.

The one-line version: **a migration is a deploy step that runs against production while old code is still serving traffic.** Every statement is judged on two questions: what lock does it take for how long, and does the code on either side of the deploy still work.

## Which tool owns which database

| Database | Tool | Migrations | Applied |
| --- | --- | --- | --- |
| Main `clay` | Sequelize `QueryInterface` (`.js`/`.ts`, `up`/`down`) | `apps/api/migrations/` | Migrate task before services roll |
| Sharded `clay_shards` (Aurora Limitless) | Sequelize, separate config | `apps/api/migrations-sharded/` | Same task |
| Terracotta | Prisma 7, `relationMode = "prisma"` (no FKs); production is ClickHouse Cloud managed Postgres 18.6, local 17, CI 16.2 | `libs/terracotta/prisma/migrations/` | `services/terracotta-migrations`, gates the deploy |
| `agents` schema (Terracotta DB) | Prisma 6 | `libs/agents/prisma/migrations/` | `apps/api/scripts/migrate-agents.ts` |
| GTM agent | Prisma 6 | `libs/gtm-agent-db/prisma/migrations/` | clay-api migrate task |
| Scheduler | Prisma 5, `relationMode = "prisma"`, Kysely types | `services/scheduler/migrations/` | Container boot (`docker-migrate.sh`); health checks kill it after a minute or two |
| Trigger-event-monitor | Kysely `Migrator` | `services/trigger-event-monitor/migrations/` | `services/trigger-event-monitor/infrastructure/scripts/migrate-db.ts` at container boot |
| Reps | Prisma 7; production is ClickHouse Cloud managed Postgres 18.6, local 14.5, CI 16.2 | `libs/reps/prisma/migrations/` | `services/reps-migrations`; no automatic rollback (`services/reps-migrations/RECOVERY.md`) |

What CI checks: the main and sharded migrations run against a real Postgres (16.2, not 14) and `apps/api/schema.sql` / `schema-sharded.sql` must match (`api-static-checks`). What CI does **not** check: lock levels, `CONCURRENTLY`, `lock_timeout`, reversibility (`migrate:undo` never runs), and oxlint ignores `migrations/**`. Every safety rule below is review-enforced unless it says otherwise; say `(unenforced)` in the Check line.

## 1. Locks: every DDL statement waits in the lock queue

PostgreSQL 14 Internals, "Relation-Level Locks": a statement that needs `ACCESS EXCLUSIVE` waits behind any running query on the table, and **every later query, including plain `SELECT`s, queues behind it**. A metadata-only `ALTER TABLE` that takes 1 ms can still stall the table for as long as the longest open transaction.

| Smell | Move | Check |
| --- | --- | --- |
| `ALTER TABLE` / `DROP` / `RENAME` / `ADD CONSTRAINT` on a hot table with no `lock_timeout` ("catalog-only" changes included: the wait, not the work, is the outage) | Main database: wrap it in `withExclusiveLockRetry` (`apps/api/migrations/lib/exclusive-lock-retry.ts`: `SET LOCAL lock_timeout` 100 ms, `statement_timeout` 5 s, retries on `55P03`). Prisma/Kysely: `BEGIN; SET LOCAL lock_timeout = '5s'; <DDL>; COMMIT;` in the migration file; a timeout fails the deploy gate, which is the intended outcome. Quantify the risk from the longest transaction on the table (for Terracotta run creation, `CHUNK_TRANSACTION_TIMEOUT_MS = 30_000` in `workflow-run-batch-creation.service.ts`) | Helper is unit-tested; Prisma precedent on the same table: `libs/terracotta/prisma/migrations/20260910190000_drop_trigger_fired_columns_from_runs/migration.sql`; use is review-only `(unenforced)` |
| `CREATE INDEX` without `CONCURRENTLY` on an existing table | `createIndexConcurrently` (`apps/api/migrations/lib/concurrent-index.ts`), which asserts `indisvalid`/`indisready` afterward | Review `(unenforced)`; 43 migrations import the helper, older ones use raw SQL |
| Index that takes minutes to build, put in a migration | Build it out-of-band first with a file in `apps/api/scripts/indexes/` via the "Run DB script" workflow (`scripts/lib/build-index.ts`), then land the migration as `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (a no-op in prod) | `DATABASE.md` rule; precedents: the three builders in `apps/api/scripts/indexes/` and `services/scheduler/migrations/20261021120000_add_snapshot_values_engine_unique_index` (header names `scripts/indexes/snapshot-values-engine-record-key.ts`) |
| `CONCURRENTLY` inside a multi-statement Prisma migration | Prisma sends a multi-statement file as one simple-query batch, which runs in an implicit transaction (`services/reps-migrations/RECOVERY.md` says not to rely on that for atomicity; write explicit `BEGIN`/`COMMIT` when you need it), and `CONCURRENTLY` fails inside one. One statement per `CONCURRENTLY` migration file | Precedent and comments: `libs/terracotta/prisma/migrations/20260707000000_slim_tc_context_droplets_indexes` through `…06` |
| A failed concurrent build retried with `IF NOT EXISTS` | A failed `CREATE INDEX CONCURRENTLY` leaves an `INVALID` index that `IF NOT EXISTS` silently accepts. Drop it, then rebuild | The helper's validity assertion |
| `ADD FOREIGN KEY` or `ADD CHECK` validated in one step on a big table | `ADD CONSTRAINT … NOT VALID` (brief lock), then `VALIDATE CONSTRAINT` in a separate statement (`SHARE UPDATE EXCLUSIVE`, does not block writes) | Review |
| `ADD UNIQUE` / `ADD PRIMARY KEY` directly | `CREATE UNIQUE INDEX CONCURRENTLY`, then `ADD CONSTRAINT … UNIQUE USING INDEX` | Review |
| `ALTER COLUMN … SET NOT NULL` on a big table | Add `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE` it, then `SET NOT NULL` (skips the scan since 12), then drop the check | Review |
| `ALTER COLUMN TYPE` | Most type changes rewrite the table and every index under `ACCESS EXCLUSIVE`. Safe without rewrite: `varchar(n)` → wider or `text`, `numeric` precision increase. Otherwise: new column, dual-write, backfill, switch, drop | Review |
| `ADD COLUMN … DEFAULT gen_random_uuid()` / `clock_timestamp()` | A volatile default rewrites the table. Add nullable, backfill in batches, then set the default for new rows | Review |
| DDL on an Aurora writer while long reports run on its readers | Readers cancel conflicting queries after at most 30 s (`versions.md`). Note it in the PR; move long reads to ClickHouse. Terracotta and Reps run on managed Postgres with an async HA standby, not Aurora readers; the same 30 s `max_standby_streaming_delay` applies there only to queries on the standby | Review |

The sharded template (`apps/api/migrations-sharded/20260511150000-add-audience-record-hash-to-big-source-records.js`) sets `SET LOCAL lock_timeout='5s'` and the Limitless `rds_aurora.limitless_create_table_mode` / `limitless_create_table_shard_key` settings. It is the only one of 21 sharded migrations that sets `lock_timeout`; flag a new one that does not.

## 2. Expand, migrate, contract: never break the code on the other side of the deploy

Refactoring Databases, "transition period"; `ROLLOUT.md`: migrations run before services roll, so for minutes the old code runs against the new schema; a rollback runs the new schema with old code for longer.

| Smell | Move | Check |
| --- | --- | --- |
| `NOT NULL` column added without a default in the same release that starts writing it | Expand: add nullable (or with a constant default). Migrate: deploy writers, backfill. Contract: tighten in a later release | `ROLLOUT.md` "additive first" |
| Column or table rename | Never rename in place. Add the new name, dual-write, backfill, move readers, stop writing the old one, drop it later | Review; one PR per step |
| Dropping a column the ORM still maps | MikroORM and Prisma select every mapped column, so the entity property is a reference. Remove the property and ship; drop the column in a later PR, after that release is on every instance | `ROLLOUT.md` "Dropping columns and tables"; precedent `libs/gtm-agent-db/prisma/migrations/20261008190000_drop_linked_resource_names` |
| Drop/rename/new `NOT NULL` in a Terracotta Prisma migration shipped with its reader | Prisma migrations gate the Terracotta deploy; additive + reader may ship together, destructive changes need two releases | `services/terracotta-service/AGENTS.md` |
| A Terracotta step column dropped in Postgres only | The ClickHouse archive copies it; the ClickHouse migration goes first | `services/terracotta-service/src/domain/__tests__/step-archive.test.ts` |
| Data-changing SQL on `clay_admin.tables`/`fields`/`views` without the `*_versions` mirror | Apply the same change to `table_versions`/`field_versions`/`view_versions` | Root `AGENTS.md`; review |
| `down` that does not mirror `up`, or a destructive `down` that loses data written since `up` | `down` reverses schema exactly, indexes included. When the reverse loses data, say so and make `down` refuse or no-op with a comment | `DATABASE.md`; `migrate:undo` never runs in CI `(unenforced)` |
| Postgres `ENUM` type | Not allowed on the main database: `text` + a `CHECK` or an application enum. Values cannot be removed and `ADD VALUE` cannot be used in the transaction that adds it | `DATABASE.md` |
| `GRANT` in a migration | Grants live in `aws-clay-mgmt` `terraform/modules/clay-engineers`; migrations do not grant | `DATABASE.md`; advisory workflow on create-table PRs |

## 3. Backfills are scripts, not migrations

| Smell | Move | Check |
| --- | --- | --- |
| `UPDATE big_table SET … WHERE …` in a migration | One statement over millions of rows holds row locks for its whole duration, generates WAL that lags the replicas and the CDC pipeline, and leaves every old row version for vacuum. Write a resumable script: walk the primary key in batches (hundreds to low thousands), one transaction per batch, `START_ID` cursor, idempotent | `apps/api/scripts/AGENTS.md`; precedent `apps/api/scripts/backfill-fields-workspace-id.ts` (`FOR UPDATE SKIP LOCKED` per batch, then a partial index on the remaining NULLs) |
| Backfill run from a laptop or a migration | Dispatch through `.github/workflows/run-db-script.yml` (ECS task, needs an engineering `YES: <reason>`) | Workflow gate |
| Backfill that rewrites a TOASTed `jsonb` column to change one key | Every update rewrites the whole value and all its WAL. Move the hot key to a column first | Review |
| Large delete by `DELETE … WHERE created_at < …` | Batch by id subquery (`DELETE … WHERE id IN (SELECT id … LIMIT n)`), benchmark at production size; for time-ranged data consider partitioning so retention is `DROP PARTITION` | `DATABASE.md` |

## 4. Schema shape: decide the types once

PostgreSQL Mistakes and How to Avoid Them (data types); Karwin (keyless entry, rounding errors).

| Smell | Move | Check |
| --- | --- | --- |
| `timestamp` without time zone | `timestamptz` | Review |
| `int` / `serial` primary key on a table that grows without bound | `bigint` (identity) or the repo default GUID text PK; an `int4` sequence overflow is an outage with no quick fix | Review |
| Random UUIDv4 primary key on an insert-heavy table | Index inserts land on random pages: more WAL, poorer cache hit rate. Prefer UUIDv7 generated in the application (`uuidv7()` exists only on the 18.6 databases and not on their local/CI floors) or a `bigint` | Review |
| `float`/`real` for money or credits | `numeric` or integer minor units | Review |
| `varchar(n)` with an arbitrary `n` | `text` plus a `CHECK (length(col) <= n)` when the limit is a business rule | Review |
| Foreign key with no index on the referencing column | Postgres does not create it; every parent delete or key update scans the child. Index it (most FKs are queried that way anyway) | Review. Terracotta, reps, scheduler use `relationMode = "prisma"`: no FK exists, so integrity is the application's job and the PR must say who enforces it |
| Status column whose values, writer, and terminal states are undocumented | Name the writer, the meaning of each value, and which states are terminal; transitions go through one helper | `DATABASE.md` ("status enums") |
| Unique constraint over nullable columns on the main database | NULLs are distinct and `NULLS NOT DISTINCT` needs 15. Partial unique index per case, or unique on `COALESCE` | `versions.md` |
| Soft-delete table with a plain unique index | Partial unique index `WHERE deleted_at IS NULL` | `DATABASE.md` |
| New table missing `workspace_id`, timestamps, or `deleted_at` defaults | Repo defaults: `schema: 'clay_admin'`, GUID text PK, timestamps, nullable `deleted_at`; deviate deliberately and say why | `DATABASE.md` |

## What to write in the PR

For every migration, four lines: the lock each statement takes and the `lock_timeout` that bounds it; table size and write rate (Aurora: Datadog or `pg_stat_user_tables`; Terracotta and Reps: `pg_stat_user_tables` through `chctl cloud postgres query`); the deploy sequence (which release expands, which contracts); and how `down` behaves. Reviewers compare those lines to the statements.
