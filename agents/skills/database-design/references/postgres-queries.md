# Postgres queries, indexes, transactions, and MVCC

Sources: SQL Performance Explained / use-the-index-luke.com (index design, pagination), PostgreSQL Query Optimization 2nd ed. (reading plans, short vs long queries, ORM shapes), PostgreSQL 14 Internals ("Isolation", "Page Pruning and HOT Updates", "Vacuum and Autovacuum", "Statistics", index chapters), DDIA 2e "Transactions", Database Internals (B-tree costs). Repo rules: `apps/api/code-agents/DATABASE.md`, `services/terracotta-service/AGENTS.md`, `libs/terracotta/AGENTS.md`. Transaction and lock *shape* (I/O inside transactions, fencing, publish after commit) is `software-design` `references/data-intensive.md`; do not duplicate those findings here.

The one-line version: **a query is reviewed at production cardinality, not at fixture size.** Name the table's row count and the rows the query touches; a plan that is fine at 10k rows can be a sequential scan of 200M.

## 1. Every query has an index story

| Smell | Move | Check |
| --- | --- | --- |
| Query on a tenant table without `workspace_id` in the predicate | Add it; it is both the tenancy boundary and the leading index column. On the sharded database, a query without it fans out to every shard | `DATABASE.md`; sharded pool logs `Sharded query without workspace_id filter` (substring match, warning only) |
| New `WHERE`/`ORDER BY` shape with no matching index | Composite index: equality columns first, then the range or sort column; the sort direction must match for `ORDER BY … LIMIT` to stop early | `EXPLAIN (ANALYZE, BUFFERS)` on production-sized data in the PR |
| New index whose leading columns duplicate an existing one | `(workspace_id, x)` already serves `workspace_id` alone; drop the redundant one, every index costs every write and blocks HOT updates on its columns | `DATABASE.md`; `pg_stat_user_indexes.idx_scan = 0` in prod for unused ones |
| Function or cast on the indexed column (`lower(email) = …`, `created_at::date = …`, `jsonb->>'k' = …`) | Rewrite as a range on the raw column, or add an expression index that matches the expression exactly | `EXPLAIN` |
| `ILIKE '%term%'` / `LIKE '%term'` | B-tree cannot serve a leading wildcard. `pg_trgm` GIN index, or send search to ClickHouse/OpenSearch | Karwin "Poor Man's Search Engine" |
| Queue-style table polled by status | Partial index `WHERE status = 'pending'` (small, stays hot); claim with `FOR UPDATE SKIP LOCKED` | Precedents: `apps/api/v3/billing/operations/expiration.service.ts`, `apps/api/modules/plays/models/play-entity.model.ts` |
| Correlated columns the planner treats as independent (`workspace_id`, `table_id`) giving 1000× row misestimates | `CREATE STATISTICS … (dependencies, ndistinct)` on the pair, then `ANALYZE` | `EXPLAIN ANALYZE` estimated vs actual rows |
| Index on a low-selectivity boolean or status used alone | The planner ignores it; make it partial or put it after a selective column | `EXPLAIN` |

## 2. Bounded reads, bounded writes

| Smell | Move | Check |
| --- | --- | --- |
| `findAll`/`select` with no `LIMIT` on a table that grows per user action | Page or chunk (the repo default is ~100 records per chunk); stream with a cursor for exports | `DATABASE.md` |
| `OFFSET n` pagination | Keyset: `WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT n`; the `id` tie-break makes it total | `DATABASE.md`; Winand "Paging Through Results" |
| `WHERE id IN (…)` built by string concatenation, or thousands of bind parameters | `= ANY($1::text[])` with one array parameter; one prepared plan for any list length | `DATABASE.md` |
| N+1: a query per row inside a loop, or an ORM `populate`/`include` that expands into one query per relation | One query with `= ANY`, or a join; on the hot path, carry the data in | Query count per N items is O(1), stated in the PR |
| `count(*)` on a big table for a badge or progress bar | Approximate (`pg_class.reltuples`), a counter maintained per chunk, or ClickHouse | Review |
| MikroORM loading 10k+ entities into the identity map | Raw Knex for large read-only lookups | `DATABASE.md` |
| Per-call database lookup added on a 100M+/day path | Cache, carry the value in the message, or batch | `DATABASE.md`; Datadog request rate in the PR |
| `SELECT *` from a table with large `jsonb`/`text` columns | Name the columns; TOASTed values are fetched and decompressed only when selected | Review |

## 3. NULLs and SQL semantics that return wrong rows

PostgreSQL Mistakes and How to Avoid Them; Karwin "Fear of the Unknown".

| Smell | Move | Check |
| --- | --- | --- |
| `NOT IN (SELECT …)` where the subquery column is nullable | One NULL makes the whole predicate unknown and returns zero rows. `NOT EXISTS` | Test with a NULL row |
| `col != 'x'` expected to include NULL rows | `col IS DISTINCT FROM 'x'` | Test |
| `BETWEEN` on timestamps | Half-open range `>= start AND < end` | Review |
| `ON CONFLICT DO UPDATE` with a batch that contains the same key twice | Fails with "cannot affect row a second time". Dedupe the batch in the application first | Test with a duplicate key |
| Upsert intended to be idempotent but bumps a sequence or `updated_at` on every retry | `ON CONFLICT DO NOTHING` + read-back, or `DO UPDATE … WHERE` the values differ | Test runs the write twice |

## 4. Transactions, isolation, and locks

DDIA 2e "Transactions" (lost update, write skew); PostgreSQL 14 Internals "Isolation", "Row-Level Locks". Postgres defaults to `READ COMMITTED`.

| Smell | Move | Check |
| --- | --- | --- |
| Read-modify-write in the application (`read balance; write balance - x`) | Atomic `UPDATE … SET balance = balance - $1 WHERE … AND balance >= $1`, or `SELECT … FOR UPDATE` first | Concurrency test with two writers |
| Check-then-insert for uniqueness | Unique index + single-statement `INSERT … ON CONFLICT`; the database is the only thing that can decide "first" | `DATABASE.md` |
| Terracotta `updateMany` used as compare-and-set | Under `relationMode = "prisma"`, `updateMany` is SELECT-then-UPDATE by id. Use `$executeRaw` with the predicate in one `UPDATE` and check the row count | `libs/terracotta/AGENTS.md`; precedent `tryConditionalSealDataList` |
| Global `prisma` used inside a `$transaction` callback | Runs on another connection, outside the transaction (SEV-169). Use `tx` | `services/terracotta-service` oxlint repository-only rule + baseline |
| Two code paths lock the same rows in different orders | Deterministic lock order (sort ids), or `pg_advisory_xact_lock(hashtextextended(key, 0))` | `DATABASE.md`; precedents `apps/api/v3/billing/services/credit-reward.service.ts`, `apps/api/modules/gtm-agent/internal/services/gtm-agent-active-task-limit.service.ts` |
| Session-level advisory lock (`pg_advisory_lock`) through a pooled connection | Through RDS Proxy or any pool, the session can outlive the request or be shared; use the `_xact_` form | Review |
| `SERIALIZABLE` or `REPEATABLE READ` without a retry on `40001` | Either retry the whole transaction on serialization failure or stay at `READ COMMITTED` with explicit locks | Review |
| Transaction left open across a network call, a queue add, or user think-time | Holds row locks and the xmin horizon: blocks vacuum database-wide, bloats every hot table | `software-design` lock-I/O rule; Terracotta lock-I/O graph test |

## 5. MVCC costs: every update is an insert

PostgreSQL 14 Internals "Pages and Tuples", "Page Pruning and HOT Updates", "Vacuum and Autovacuum", "Freezing".

| Smell | Move | Check |
| --- | --- | --- |
| Frequently updated column that is also indexed | Updating any indexed column defeats HOT; every update writes a new entry in every index. Drop the index, or move the hot column to its own narrow table | `pg_stat_user_tables.n_tup_hot_upd / n_tup_upd` |
| Hot counter or status row updated per event | One row version per update plus vacuum work; see `software-design` hot-row list. Per-chunk rows rolled up later | Hot-row list |
| Frequently rewritten large `jsonb` document | Each change writes a full new TOASTed copy and its WAL. Hot keys become columns | `DATABASE.md` (typed columns over JSONB) |
| Long-running query or idle-in-transaction session on the writer | Pins the xmin horizon; dead rows in every table stay. `idle_in_transaction_session_timeout` / `statement_timeout` on the role. On Terracotta and Reps (managed Postgres) all three timeouts are 0 at the server, so a long transaction is bounded only by what the code sets (`CHUNK_TRANSACTION_TIMEOUT_MS` in Terracotta) | Aurora: Datadog `postgresql.transactions.duration.max`; managed Postgres: `pg_stat_activity` via `chctl cloud postgres query` |
| Table with huge insert-then-delete churn (queues, sessions) | Tune per-table autovacuum (`autovacuum_vacuum_scale_factor`) or partition by time and drop partitions | Review |

## 6. Reading plans

Ask for `EXPLAIN (ANALYZE, BUFFERS)` from a database with production-shaped data (a staging snapshot, not a fresh local DB), and read it for: estimated vs actual rows (misestimate > 10× means stale or missing statistics), `Rows Removed by Filter` much larger than rows returned (missing index or wrong column order), sequential scans on large tables, sorts spilling to disk (`external merge`), nested loops over large outer sets, and shared `read` buffers (cold I/O) vs `hit`. On Postgres 17 databases `EXPLAIN (SERIALIZE)` also shows the cost of sending large results. Prisma and MikroORM use prepared statements: after five executions Postgres may switch to a generic plan, so a query that is fast for one workspace can be slow for a large one; test with the largest tenant's parameters.

## What to write in the PR

For a new or changed query on a production table: row count of the table, rows the query reads and returns, the index it uses (plan excerpt), and how often it runs (per request / per job / per step, with the Datadog rate). For a new transaction: what it locks, for how long, and why the isolation level is enough.
