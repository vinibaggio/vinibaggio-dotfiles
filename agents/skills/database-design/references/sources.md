# Sources: the database canon behind this skill

Chosen 2026-11 for the versions in `versions.md`: Aurora PostgreSQL 14/16/17 and ClickHouse Cloud managed Postgres 18 (Terracotta, Reps), ClickHouse Cloud 26.2–26.8, ElastiCache Valkey 8.0/8.1 and Redis OSS 7.0/7.1. A book earns a place when it is the best current source for a decision this repo makes, and when its version matches ours closely enough that its advice is still true. Nothing here restates a book; the engine references map each source to the smells this repo has.

Cite sources by chapter title, not number, in findings. Chapter numbers moved between DDIA editions.

## Broad: data systems and SQL

| Source | Edition / year | Why it is here | Used in |
| --- | --- | --- | --- |
| **Designing Data-Intensive Applications**, Kleppmann & Riccomini | 2nd ed., O'Reilly, 2026 ([announcement](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)) | The frame for every trade-off: storage engines (B-tree vs LSM, column stores), encoding and schema evolution, replication lag, sharding (including sharding for multitenancy), isolation anomalies (lost update, write skew, phantoms), fencing tokens, derived data. The 2nd edition adds cloud-native storage and renames "Partitioning" to "Sharding". | `data-modeling.md`, all engine files |
| **Database Internals**, Alex Petrov | O'Reilly, 2019 | How B-trees, LSM trees, and WAL work at page level. Still the clearest text for why an index costs writes and why ClickHouse merges parts. No newer replacement. | `postgres-queries.md`, `clickhouse.md` |
| **SQL Antipatterns, Volume 1**, Bill Karwin | Pragmatic, Oct 2022 | Named schema and query antipatterns (Entity-Attribute-Value, polymorphic associations, multi-column attributes, keyless entry, pattern-matching search, index shotgun) with the fix for each. The names make findings short. | `data-modeling.md` |
| **SQL Performance Explained** + [use-the-index-luke.com](https://use-the-index-luke.com), Markus Winand | 2012; site maintained | Index design: column order, range vs equality, index-only scans, keyset pagination, why `OFFSET` is linear. Vendor-neutral and still correct; nothing newer covers it better. | `postgres-queries.md` |
| **Refactoring Databases**, Ambler & Sadalage | Addison-Wesley, 2006 | The origin of expand/contract ("transition period") schema changes: every rename, split, and drop as a sequence of deployable steps. Old, but the catalog is the reference the industry still cites. | `postgres-migrations.md` |

## Postgres

| Source | Edition / year | Version | Why it is here |
| --- | --- | --- | --- |
| **PostgreSQL 14 Internals**, Egor Rogov | Postgres Professional, 2023, [free PDF](https://postgrespro.com/community/books/internals) | 14 | MVCC, snapshots, HOT updates, vacuum and freezing, buffer cache and WAL, lock levels, planner statistics, every index type. Matches the main database exactly. Russian editions for 17 (2025) and 18 (2026) exist; no English edition past 14 as of this writing. |
| **PostgreSQL Query Optimization**, Dombrovskaya, Novikov, Bailliekova | 2nd ed., Apress, Jan 2024 | 15–16 era | Reading `EXPLAIN`, short vs long queries, join order, when indexes stop helping, ORM-generated query shapes, the N+1 problem as a planner sees it. |
| **PostgreSQL Mistakes and How to Avoid Them**, Jimmy Angelakos | Manning, June 2025 | 17 era | Mistakes reviewers actually see, each with a demo: data-type choices, SQL that misbehaves with NULLs, configuration and operations, security, upgrades and migrations. Short, current, finding-shaped. Read alongside the PostgreSQL wiki page "Don't Do This". |
| **High Performance PostgreSQL for Rails**, Andrew Atkinson | Pragmatic, June 2024 | 16 | Rails examples, but the migration-safety, index-maintenance, bloat, partitioning, and connection-pool chapters apply to any ORM. The best practical text on shipping schema changes to a busy production database. |
| **Mastering PostgreSQL 17**, Hans-Jürgen Schönig | 6th ed., Packt, 2024 | 17 | Reference for the Postgres 17 features available on Terracotta and GTM agent (`JSON_TABLE`, `MERGE … RETURNING`, logical replication changes). Use for lookup, not as a design authority. |
| PostgreSQL documentation: "Explicit Locking" (lock-mode conflict table), `ALTER TABLE` notes, release notes for 15/16/17/18 | per version | 14–18 | Ground truth for which lock a DDL statement takes and which release added a feature. Link the versioned page (`/docs/14/…`) in findings about the main database; `/docs/18/…` for Terracotta and Reps runtime behavior. |
| AWS: Aurora PostgreSQL user guide, [long-running reader queries](https://aws.amazon.com/blogs/database/manage-long-running-read-queries-on-amazon-aurora-postgresql-compatible-edition/), Limitless Database guide | current | Aurora | Reader cancellations, vacuum blockers, Limitless sharding rules. |
| ClickHouse Cloud: managed Postgres docs and `chctl cloud postgres` (`query`, `metrics`, `slow-queries`, `config`) | current (Beta) | Terracotta, Reps | The only metrics and settings source for these services; Datadog has none. |

Considered and not used: *The Art of PostgreSQL* (Fontaine, 2nd ed. 2020) is good on SQL-first application design but predates 14 and adds little the books above don't. *Learn PostgreSQL* and the Packt cookbooks are administration-oriented.

## ClickHouse

No book matches ClickHouse 26.x. The engine changes monthly (JSON type, lightweight updates, text indexes, and refreshable materialized views all moved tiers between 24.x and 26.x), so a printed book is out of date on arrival. Primary sources instead:

| Source | Why it is here |
| --- | --- |
| **"ClickHouse – Lightning Fast Analytics for Everyone"**, Schulze et al., [VLDB 2024](https://www.vldb.org/pvldb/vol17/p3731-schulze.pdf) | The architecture paper: MergeTree parts and merges, sparse primary index and granules, skip indexes, merge-time transformations (Replacing/Aggregating/Collapsing), materialized views as insert triggers, the vectorized engine. The mental model every schema finding rests on. |
| ClickHouse docs: "Best practices" section, "Data modeling" guides, `system.settings` `tier` column | Current per version. The repo skill `clickhouse-best-practices` compiles 31 of these rules; this skill defers to it. |
| Repo skills `clickhouse-best-practices`, `clickhouse-architecture-advisor` | Rule-level guidance with provenance labels. Load them for ClickHouse work; this skill adds version gates, cross-engine design, and repo precedent. |
| DDIA 2e "Storage and Retrieval" (column-oriented storage), Database Internals (LSM trees) | Why sort order, compression, and merges dominate ClickHouse performance. |

Considered and not used: *Mastering ClickHouse* (Robert Johnson, 2024/25) is generic and not tied to a version; *Up and Running with ClickHouse* (BPB) predates the JSON type and Cloud's SharedMergeTree.

## Redis and Valkey

No current book covers Valkey 8 or Redis 7 operations in depth. The classic, *Redis in Action* (Carlson, Manning 2013), predates Streams, Functions, and ACLs; its data-structure patterns (counters, leaderboards, rate limiters, autocomplete) still hold. *Redis Stack for Application Modernization* (Fugaro & Ortensi, Packt 2023) covers modules that ElastiCache Valkey 8 does not run. Primary sources instead:

| Source | Why it is here |
| --- | --- |
| [valkey.io documentation](https://valkey.io/topics/) (eviction, latency, persistence, replication, cluster spec, programmability) and command pages with their "Time complexity" and "Available since" lines | Ground truth for complexity, version gates, and replication semantics on our engines. |
| Kleppmann, "[How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)" (2016) and DDIA 2e "The Trouble with Distributed Systems" | Why a Redis lock (Redlock or single-node) is an efficiency lock, never a correctness lock, and what a fencing token adds. |
| [BullMQ: Going to production](https://docs.bullmq.io/guide/going-to-production) | `maxmemory-policy noeviction` is required for queues; AOF persistence; `maxRetriesPerRequest: null` for workers; job retention. |
| AWS ElastiCache docs: engine versions, parameter defaults (`maxmemory-policy` defaults to `volatile-lru`), durability options, and the "Design patterns for Valkey" whitepaper (2025) | The managed-service behavior our clusters actually have. |
