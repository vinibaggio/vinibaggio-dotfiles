# Redis and Valkey: caches, queues, locks, and rate limits

Sources: valkey.io documentation (eviction, latency, persistence, replication, programmability, command complexity), Kleppmann "How to do distributed locking" and DDIA 2e "The Trouble with Distributed Systems" (process pauses, fencing), BullMQ "Going to production", AWS ElastiCache docs, Redis in Action (data-structure patterns only). Repo rules: `apps/api/code-agents/JOBS_AND_QUEUES.md`, `services/terracotta-service/AGENTS.md`, `services/scheduler/AGENTS.md`.

The one-line version: **Redis is a single-threaded, asynchronously replicated, memory-bounded process.** Every review asks: what happens to this key when memory fills, when the primary fails over, and when one command touches a million elements.

## Repo map

| Concern | Where |
| --- | --- |
| Named clients (`ApiRedisClientName`, ~24 clients, one config prefix each) | `apps/api/modules/redis/redis.ts`, `libs/shared-backend/src/services/redis.ts` |
| Client → ElastiCache cluster | Hosts come from secrets, not the repo. Most client names match a cluster id (`run-status-cache`, `action-result-cache`, `action-task-polling`, `record-lookup-index`, `notification-limiter`, `rate-limits`, `credit-cache`, `rts-relay`, `bullmq`); match them against `versions.md`. The generic `REDIS` prefix is not mapped in the repo: [INFERENCE] `clay-redis-prod-2023-*` (Redis 7.0.7, the busiest node); confirm before adding load to it |
| BullMQ wrapper (`defineJobQueue`, `defineJobHandler`; `attempts: 2`, exponential 5 s backoff, `removeOnComplete/Fail: 1000`) | `apps/api/modules/job-queue/job-queue.ts` |
| Terracotta queues | `services/terracotta-service/src/infrastructure/job-queue.ts` |
| Lua helpers: three, with different signatures | `libs/shared-backend/src/services/redis.ts` (`defineLuaScript`/`callLuaScript`, template tag forbids interpolation); `libs/shared-backend/src/ratelimit/helpers/redis.ts` (`callLuaScript(loadScript, keyArgs, otherArgs)`); `apps/api/externalServices/redis-script.ts` (`registerRedisScript`/`evalScript`, used by billing). All reload on `NOSCRIPT` |
| Counters with a cap (closest precedents) | Redis fixed window: `services/terracotta-service/src/services/sculptor-rate-limit.service.ts` (bare `eval`, rolling 24 h). Redis + Postgres + ClickHouse credit system: `clay-credit-budgets` and `clay-credit-reporting` repo skills. Postgres daily upsert cap: `apps/api/v3/ai/models/cpj-search-usage.model.ts` |
| Fair queue | `libs/shared-backend/src/fair-queue/`, `clay-audiences` skill `references/fair_queue.md` |
| Caches | `libs/shared-backend/src/api-value-cache/api-value-cache.ts` (Redis + LRU), `apps/api/v3/tables/services/record-lookup-cache.service.ts` |
| Pub/sub and streams | RTS relay (`RTS_RELAY_REDIS`), `libs/shared-backend/src/ui-message-streams/`, `libs/shared-backend/src/progress-streaming/` (iovalkey) |

No code uses cluster mode: no `Redis.Cluster`, no hash tags, and multi-key Lua (`apps/api/v3/billing/infrastructure/credit-balance-operation.ts`) assumes one node. A change that introduces cluster mode or a new multi-key script on a cluster-mode endpoint is a design question, not a review nit.

## 1. One thread executes every command

Valkey 8 adds I/O threads, but commands still execute one at a time. An O(N) command on a big key stalls every client of that node, including BullMQ workers sharing it.

| Smell | Move | Check |
| --- | --- | --- |
| `KEYS pattern`, `SMEMBERS`/`HGETALL`/`LRANGE 0 -1`/`ZRANGE 0 -1` on a key that grows with tenant data | `SCAN`/`SSCAN`/`HSCAN`/`ZSCAN` with `COUNT`, or bound the collection | Command complexity line on valkey.io; `SLOWLOG` |
| `DEL` of a large key | `UNLINK` (frees memory on a background thread) | Review |
| Unbounded set, list, stream, or sorted set per workspace | Cap it (`LTRIM`, `XADD … MAXLEN ~`, `ZREMRANGEBYRANK`) or expire it | Review: "no unbounded sets" |
| One round trip per item in a loop | Pipeline or a Lua script; `MGET`/`MSET` | Command count per N items is O(1) |
| Lua script that loops over a whole collection | Scripts block the node for their full run; bound the work per call | Review |

## 2. Memory fills: decide what happens to each key

ElastiCache's default `maxmemory-policy` is `volatile-lru`: only keys with a TTL are evicted; when none are left, writes fail with OOM.

| Smell | Move | Check |
| --- | --- | --- |
| Cache key written without a TTL | Every cache key gets a TTL; under `volatile-*` a key without one is never evicted and eventually turns the node read-only for writes | Review: "explicit TTL on every key" |
| BullMQ queue on a cluster shared with caches | BullMQ requires `maxmemory-policy noeviction`; eviction deletes job hashes and locks and corrupts the queue. Queues get their own cluster (the repo already splits `*-bullmq-*` clusters) | Check the cluster's parameter group in the PR when adding a queue to a new endpoint |
| Large serialized values (whole rows, LLM payloads) cached per request | Memory and network cost per hit; cache ids or a compact projection; compress over a few KB | Value size in the PR |
| Local in-process cache layered over Redis with a longer TTL | Local TTL must be shorter than the Redis TTL, or invalidations never reach it | `JOBS_AND_QUEUES.md` |

## 3. Replication is asynchronous; failover loses acknowledged writes

ElastiCache replicas apply writes after the primary acknowledges them. A failover can drop the last writes. `WAIT`/`WAITAOF` narrow the window but do not make Redis a consistent store.

| Smell | Move | Check |
| --- | --- | --- |
| Redis as the only copy of data that matters (balances, entitlements, job results the user paid for) | Postgres is the source of truth; Redis holds a derived copy that can be rebuilt. Read `apps/api/v3/billing/services/credit-balance.service.ts` (dirty-keyset flush) before changing the credit-balance keys. Where Redis must hold the authoritative value briefly, the repo pauses writes around planned failovers: `apps/api/v3/billing/services/credit-grant-pause.ts` (Eppo kill switch, 503 during credit-cache maintenance) | PR names the source of truth and the rebuild path |
| Cache filled before the database commit, or invalidated before it | Write the database, commit, then invalidate or update the cache; a reader between the two refills the old value otherwise. Versioned keys or a short TTL bound the damage | `software-design` "publish after commit" |
| Bare `redis.eval`/`evalsha` outside the helpers | After failover or restart the script cache is empty. Use one of the three helpers in the repo map, which reload the script on `NOSCRIPT` and retry | Review; bare `eval` exists in `apps/api/v3/auth/services/app-account-federation-setup.service.ts` and `services/terracotta-service/src/services/sculptor-rate-limit.service.ts`; do not copy them |

## 4. Locks are efficiency locks

Kleppmann, "How to do distributed locking": a lock in Redis (single node or Redlock) cannot guarantee mutual exclusion through a process pause, a clock jump, or a failover. It is fine for "avoid doing the same work twice"; it is wrong for "two writers would corrupt data".

| Smell | Move | Check |
| --- | --- | --- |
| Redis lock protecting a correctness invariant (money, a single side effect) | Enforce the invariant where the data lives: Postgres unique constraint, fenced `UPDATE … WHERE generation = $n`, or `pg_advisory_xact_lock` | `software-design` fencing rules |
| Lock acquired with `SET key val` then `EXPIRE` (two commands) | `SET key token NX PX ttl` in one command; release with compare-and-delete Lua on the token | Precedents: `services/audiences/src/utils/redis-cache-client.ts`, `apps/api/v3/billing/stripe/upgrade-proration-checkout.ts` |
| Lock TTL shorter than the work it guards, with no renewal | The lock expires mid-work and a second worker starts. Renew (heartbeat) or size the TTL to the timeout of the work | Review |
| Redlock on a single node | Redlock's quorum adds nothing on one node; a plain `SET NX PX` with a token does the same. Existing uses: `libs/shared-backend/src/ratelimit/check-salesforce-quota.ts`, `fair-queue/partition-load-score-collector.ts` | Review |

## 5. Counters, quotas, and rate limits

Redis in Action (counters, rate limiters); DDIA 2e "Transactions" (write skew).

| Smell | Move | Check |
| --- | --- | --- |
| Read the counter, compare to the limit, then `INCR` (two round trips) | Concurrent callers all pass the check. `INCR` first and compare its return value (over-admission bounded by in-flight calls), or do check-and-increment in one Lua script | Concurrency test with two callers |
| `INCR` then a separate `EXPIRE`, or `EXPIRE` on every hit | A crash between the two leaves a counter with no TTL; resetting the TTL on every hit makes an active key immortal. One script: `INCR`, then `EXPIRE key ttl NX` (Redis 7.0+/Valkey 8) | Test asserts the TTL after two increments |
| Hash with one field per period plus `HEXPIRE` | `HEXPIRE` needs Valkey 9; every cluster here rejects it. One key per (tenant, period) with its own TTL | `versions.md` |
| "Per day" without saying which day | Rolling 24 h from the first call (the Terracotta precedent) and UTC calendar days (ClickHouse dashboards, `cpj_search_usage`) never line up. Key by UTC `YYYY-MM-DD` when anything else reports the same number per day | Unit test at 23:59:59Z / 00:00:01Z |
| The same quantity counted in Redis for enforcement and in ClickHouse/Postgres for display, with different events | Define the counted event once and count it at one place; otherwise the cap and the dashboard disagree daily | Test that drives both counters with the same edge cases (zero-cost, refunded, retried) |
| Counter in Postgres updated per event on a hot path | One new row version per update; fine at search-API rates (`cpj_search_usage` daily upsert), not at tens of millions of events a day on the main database. State the rate | Datadog request rate in the PR |
| Fail-open vs fail-closed on Redis error left implicit | Decide per limit and write it down; repo precedents differ (`sculptor-rate-limit.service.ts` fails closed; credit budgets fail open on a missing cache) | Test with Redis unavailable |

## 6. Queues (BullMQ)

| Smell | Move | Check |
| --- | --- | --- |
| `add` without a deterministic `jobId` | Derive it from the entity and its version so a retried producer is a no-op; no `:` in the id | `validateJobId` warns; `JOBS_AND_QUEUES.md` |
| Handler re-enqueues itself to reschedule | `moveToDelayed` + `DelayedError` | `JOBS_AND_QUEUES.md` |
| Per-run or per-step queue operations added on a hot path | The broker is one thread and peaks with Postgres load; count queue ops per run in the PR | `services/terracotta-service/AGENTS.md` |
| Worker connection without `maxRetriesPerRequest: null` | Workers break on transient errors; the repo clients set it | BullMQ docs; repo clients |
| Sensitive data in job payloads | Job data is stored in clear text; pass ids, read the data in the handler | BullMQ docs |
| `removeOnComplete`/`removeOnFail` unset on a new queue | Completed jobs are kept forever; the wrapper defaults to 1000, keep it | Wrapper default |

## 7. Pub/sub and streams

| Smell | Move | Check |
| --- | --- | --- |
| Pub/sub used for a message that must not be lost | Pub/sub is at-most-once: a disconnected subscriber misses messages. Use a stream with a consumer group (`XREADGROUP`, `XACK`, `XAUTOCLAIM` for stuck entries), Kafka, or a database row plus a reconciler | Review |
| Stream with no `MAXLEN`/`MINID` trimming | Grows until memory fills | Review |

## 8. Version gates

Hash-field TTL (`HEXPIRE`), numbered databases in cluster mode, and atomic slot migration need Valkey 9; no cluster here runs it. `WAITAOF` is on Valkey 8 but not Redis OSS 7.0/7.1. Full table: `versions.md`.

## What to write in the PR

For a new key family: key pattern (with the workspace id for tenant data), TTL, maximum size per key and expected key count, the target cluster and its engine version, eviction behavior of the target cluster, and the source of truth if the key is lost. For a new queue: target cluster, `jobId` scheme, queue ops per user action, retention.

Sizing a cluster before adding load (read-only Datadog, by `cacheclusterid`): `aws.elasticache.engine_cpuutilization` (the one thread that runs commands), `aws.elasticache.database_memory_usage_percentage`, `aws.elasticache.evictions` (non-zero means keys are already being dropped), `aws.elasticache.curr_items`. Example, 24 h to 2026-11-06: `clay-redis-prod-2023-001` peaked at 54% engine CPU and 60% memory with 14.2M keys and 0 evictions. The `maxmemory-policy` lives in the cluster's parameter group, which is not in the repo or Datadog; ask for it rather than reading AWS directly.
