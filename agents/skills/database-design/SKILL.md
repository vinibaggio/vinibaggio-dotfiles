---
name: database-design
description: USE THIS whenever a diff or a design touches a database, alongside `software-design`. Triggers on code review and on the pre-push gate when the diff changes migrations, Prisma/Sequelize/Kysely schemas, SQL or ORM queries, indexes, transactions or row locks, ClickHouse tables/MVs/queries, or Redis/Valkey keys, Lua, locks, and BullMQ queues. Also triggers in design discussions before any code or PR exists ("where should this data live", "should we add an index/column/table", "Postgres or ClickHouse", "cache this in Redis?", data models, backfills, retention). Specialist reviewer for Postgres (Aurora 14/16/17; ClickHouse Cloud managed Postgres 18 for Terracotta and Reps), ClickHouse Cloud 26.x, and Valkey 8 / Redis 7, version-aware to what production runs.
---

# Database design for coding agents

The team's database canon, distilled into moves an agent can apply and checks that catch regressions, pinned to the engine versions production runs. Sources (`references/sources.md`): Designing Data-Intensive Applications 2nd ed. (Kleppmann & Riccomini, 2026), Database Internals (Petrov), SQL Antipatterns Vol. 1 (Karwin, 2022), SQL Performance Explained (Winand), Refactoring Databases (Ambler & Sadalage), PostgreSQL 14 Internals (Rogov), PostgreSQL Query Optimization 2nd ed. (Dombrovskaya et al., 2024), PostgreSQL Mistakes and How to Avoid Them (Angelakos, 2025), High Performance PostgreSQL for Rails (Atkinson, 2024), the ClickHouse VLDB 2024 paper, and the valkey.io, BullMQ, and AWS docs. Nothing here restates a book; each reference maps a source to the smells this repo has and the move that fixes them.

This skill specializes `software-design`, which owns transaction and lock *shape* (no I/O inside a transaction, fencing, publish after commit, replica reads). This skill owns the database itself: schema, migrations, indexes, query plans, isolation, engine choice, ClickHouse merge semantics, Redis memory and failover. Transaction and lock *shape* (deterministic lock order, advisory locks, events after commit: `apps/api/code-agents/DATABASE.md` "Transactions"; no I/O inside a transaction or lock, Postgres only for strong consistency and ClickHouse for high-volume reads: `services/terracotta-service/AGENTS.md` and `docs/workflows/AGENTS.md`) is owned by those docs; this skill cites those rules and does not restate them. Domain repo skills (in the clay-base checkout under `.agents/skills/`, not `~/.agents/skills/`) add rules this one defers to: `clickhouse-best-practices` and `clickhouse-architecture-advisor` for any ClickHouse work; `clay-audiences`, `audiences-platform-review`, and `audiences-data-modeling-review` for Audiences (Vitess + ClickHouse); `clay-credit-budgets` and `clay-credit-reporting` for anything that counts usage per workspace or enforces a limit (the repo's Redis-Lua + Postgres + ClickHouse credit system); `workflows-platform` for Terracotta.

## The bar for a database finding

Same bar as `software-design`. A finding names all four:

1. **Smell**: what is wrong, with a file or a shape ("`ALTER TABLE fields ADD CONSTRAINT … FOREIGN KEY` validated in one step", "cache key with no TTL on a `volatile-lru` cluster").
2. **Engine and version**: which database the code runs against and whether the version matters (`references/versions.md`). A recommendation that needs Postgres 15 on the main database (14.20) is itself a bug.
3. **Move**: the named fix with its first step (`NOT VALID` then `VALIDATE`; keyset pagination on `(created_at, id)`; `argMax … GROUP BY` instead of assuming one row).
4. **Check**: what fails if someone undoes it: a helper with tests (`createIndexConcurrently`, `withExclusiveLockRetry`), a CI job (schema drift, ClickHouse migration check), a lint rule, a test with a NULL row or a duplicate key or two concurrent writers, an `EXPLAIN` in the PR. Most migration-safety rules here have no automated check; say `(unenforced)` when that is the truth.

Scale is evidence. When a finding depends on table size, write rate, or query frequency, get the number (read-only Datadog and ClickHouse are pre-approved) and cite the query and window. "This table is large" is not a finding; "`fields` is ~200M rows, `ADD CONSTRAINT` without `NOT VALID` scans it under `SHARE ROW EXCLUSIVE`" is.

"Add an index", "consider performance", "use transactions" are not findings.

## When to load this skill

- **Design discussions, before code.** Someone asks where data should live, whether to add a table/column/index, Postgres vs ClickHouse vs Redis, how to backfill, how to retain or delete, how a cache stays correct. Run the design procedure below and answer with its outputs.
- **Writing a change.** Before writing a migration, a new query on a production table, a ClickHouse table or MV, or a new Redis key family or queue.
- **Code review.** Every review whose diff touches the surfaces in the description, including reviews of other people's PRs.
- **Pre-push gate.** `pre-push-review` runs this as the database review (brief C) whenever the diff touches those surfaces.

## Design procedure

Run this for any change that adds or reshapes stored data. Write the answers in the plan or the PR description.

1. **Name the store and the version.** Which database owns the data (`references/data-modeling.md` §1) and which engine version runs it in production (`references/versions.md`). If two stores hold the fact, name the authoritative one and the rebuild path.
2. **Size it.** Current rows, growth per day, write rate, read rate, the largest tenant. Query production; do not estimate.
3. **Write the dominant queries first, then the schema.** The sort key, primary key, and indexes come from the queries (`references/postgres-queries.md` §1, `references/clickhouse.md` §1). Every tenant query leads with `workspace_id`.
4. **Decide how duplicates, retries, and deletes behave.** Unique constraint + `ON CONFLICT` in Postgres; version column and read-time dedupe in ClickHouse; deterministic `jobId` in BullMQ; TTL and eviction behavior in Redis.
5. **Plan the rollout as expand → migrate → contract** (`references/postgres-migrations.md` §2). Name the lock each DDL statement takes and its `lock_timeout`, which release expands, how the backfill runs (a resumable script, not a migration), and which release contracts.
6. **Plan retention.** How the data stops growing: partition drop, TTL, archive, or a stated reason it never needs to.
7. **Put the check in.** A test that runs the write twice, a test with a NULL or a duplicate, an `EXPLAIN` in the PR, a helper instead of raw DDL. If the check cannot exist, say `(unenforced)` and why.

## Which reference, by task

| You are about to | Read |
| --- | --- |
| Decide where data lives, model a new entity, plan tenancy or retention | `references/data-modeling.md` |
| Write or review a Postgres migration, DDL, backfill, or new column type | `references/postgres-migrations.md` |
| Write or review a Postgres query, index, transaction, row lock, or upsert | `references/postgres-queries.md` (and `software-design` `references/data-intensive.md` for lock shape) |
| Add or change a ClickHouse table, MV, insert path, or query | `references/clickhouse.md`, then the repo skills it names |
| Add a Redis/Valkey key family, cache, lock, rate limit, Lua script, stream, or BullMQ queue | `references/redis-valkey.md` |
| Use any feature newer than the oldest production version, or recommend syntax | `references/versions.md` |
| Cite a book or check why a source was chosen | `references/sources.md` |

## Review output

```
## Database review

{one sentence: what the change stores or queries, which database and version, and the promise it touches}

### Findings

**P1** · `path:line` · {engine version} · smell
> Failure: {input or sequence, then the wrong outcome or the lock/outage}.
> Move: {named fix, first step}.
> Check: {helper / CI job / test / EXPLAIN that catches regression, or "(unenforced): why"}.
```

Severity follows `pre-push-review`:

- **P1**: wrong results or data loss (NULL semantics, non-idempotent upsert, ReplacingMergeTree read without dedupe, cache as source of truth), a migration that takes a blocking lock on a hot table without `lock_timeout` or rewrites it, a deploy-order break (dropped or renamed column still mapped, `NOT NULL` before writers ship), a feature that the production version or the lowest version you may assume (`versions.md`) does not have, a queue on an evicting cluster.
- **P2**: a real cost on a plausible path: missing index for a new production query, unbounded read, N+1, `OFFSET` pagination on a user-facing list over a growing table (`DATABASE.md` accepts `OFFSET` batching with a deterministic `ORDER BY` for scripts), per-event ClickHouse inserts, no TTL on a cache key, O(N) Redis command on a growing key, a backfill in a migration, a new "never" with no check.
- **P3**: type nits (`varchar(n)` vs `text`), redundant-but-harmless index, naming.

Order by blast radius: data integrity, then locks and outages, then hot-path cost. Say when a helper, CI job, or test already catches the issue. Do not flag code the diff does not change. If there are no findings, one line. When a co-loaded repo skill prescribes its own output (for example `clickhouse-best-practices` "Rules Checked / Violations"), use this format and cite that skill's rule names inline.

For a design discussion with no diff, replace `path:line` with `shape:` plus the proposal item, and end with the design procedure answers that are still missing. The engine and version in each finding are those of the store the finding is about; a "wrong store" finding names the proposed store's version and the recommended one's.

## House positions

Decisions the repo's docs already take; do not relitigate them. Each names its source.

- Postgres (Vitess for Audiences) is the source of truth for anything a user was promised. ClickHouse and Redis hold derived copies that can be rebuilt (`services/audiences/AGENTS.md`, `services/terracotta-service/AGENTS.md`).
- Schema changes ship expand → migrate → contract across releases. No in-place renames. Columns are dropped only after a release that no longer maps them (`ROLLOUT.md`).
- On the main database, index builds on existing tables go through `createIndexConcurrently` and exclusive-lock DDL through `withExclusiveLockRetry`; slow indexes are built out-of-band through the DB-script workflow before the migration lands (`DATABASE.md`). Prisma and Kysely databases use one `CONCURRENTLY` statement per migration file.
- Backfills are resumable, batched, idempotent scripts dispatched through `run-db-script.yml`, never data-changing migrations over large tables (`apps/api/scripts/AGENTS.md`).
- Uniqueness is a database constraint plus a single-statement upsert, never check-then-insert (`DATABASE.md`). Under `relationMode = "prisma"`, compare-and-set is `$executeRaw` with the predicate in the `UPDATE` (`libs/terracotta/AGENTS.md`).
- Every tenant query filters on `workspace_id`; on the sharded database it is mandatory (`DATABASE.md`).
- No Postgres `ENUM` types on the main database. Typed columns over `jsonb` for anything filtered, sorted, or updated on its own (`DATABASE.md`).
- ClickHouse migrations are forward-only, idempotent, and expand-only; replication owns CDC tables; readers of Replacing tables dedupe at read time unless a `[##]` marker records otherwise (`services/audiences/AGENTS.md`, `services/terracotta-service/AGENTS.md`).
- Deterministic `jobId` per entity; reschedule with `moveToDelayed`, never by re-enqueueing from the handler; local cache TTL shorter than the Redis TTL (`JOBS_AND_QUEUES.md`).

## Rules this skill adds

Not yet written down elsewhere in the repo; apply them, label findings with "(this skill's rule)", and expect pushback.

- Every lock-taking DDL migration on a Prisma or Kysely database (anything but a single-statement `CREATE INDEX CONCURRENTLY` file, which cannot run in a transaction) sets `lock_timeout` first (`BEGIN; SET LOCAL lock_timeout = '5s'; …; COMMIT;`). Today 2 of the 148 lock-taking Terracotta migrations, 3 of 8 trigger-event-monitor, and none of the Reps, GTM-agent, `agents`, or scheduler migrations do.
- Every Redis cache key has a TTL, and no per-tenant collection grows without a cap (ElastiCache defaults to `volatile-lru`).
- Queues live on `noeviction` clusters separate from caches (BullMQ's production guide). The repo already separates `*-bullmq-*` clusters; the parameter group is not recorded anywhere in the repo.
- Redis locks are efficiency locks; a correctness invariant is enforced in Postgres with a constraint or a fenced update (Kleppmann, "How to do distributed locking").
