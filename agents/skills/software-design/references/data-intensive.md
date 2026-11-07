# Data-intensive design: concurrency without locks

Source: Designing Data-Intensive Applications, chapters 5 (replication), 7 (transactions), 8 (the trouble with distributed systems), 9 (consistency), 11 (stream processing), 12 (derived data). This file keeps the parts that decide how a hot path in this repo is written: Postgres (commit-bound, `relationMode = "prisma"` in Terracotta so no FK cascades), BullMQ on a single-threaded Valkey, Kafka as the durable buffer, ClickHouse as a CDC-fed read replica.

The one-line version: **a hot path is a stream processor**. Each job is a message; the database write is the only place ordering is decided; everything else must tolerate duplicates, reordering, and a worker dying between any two lines.

## 1. Exactly-once is at-least-once plus idempotence

DDIA chapter 11: no delivery mechanism gives you exactly-once; you get it by making the effect of a message idempotent. Retries are not a failure mode, they are the normal mode.

| Smell                                                                                         | Move                                                                                                                                                                          | Check                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `queue.add(name, payload)` with no `jobId`; a retried producer enqueues twice                 | Derive the id from the entity and its version: `step-<id>-g<generation>`, `delay-<stepId>`, `deliver-<stepId>-e<epoch>`. The queue de-duplicates for free                     | Lint or test: every `add`/`addBulk` passes `jobId`; exceptions carry a reason        |
| `const exists = await find(...); if (!exists) await create(...)` on the hot path              | Insert with a deterministic primary key and `skipDuplicates` (or `ON CONFLICT DO NOTHING`), then read back. The database is the only thing that can decide "first"            | Integration test that runs the producer twice and asserts one row                    |
| Handler does "read status, decide, write status" and assumes it is the only worker on the row | Fence the write: `UPDATE … WHERE id = $1 AND generation = $2` (or `status = $expected`) and treat zero rows as "someone else moved it, stop". DDIA calls this a fencing token | The transition helper enforces `expectGeneration`; a mismatch is counted, not silent |
| Callback from an external system applied without checking which attempt it belongs to         | Carry the attempt (generation, epoch) in what you hand to the external system; reject callbacks for a stale attempt                                                           | Test: callback with an old generation is a no-op                                     |

Precedent in the repo: `step-transition.service.ts` (`expectGeneration`, `guard`), `successorStepId` + `createManyAndReturn({ skipDuplicates })`, deterministic run ids from Kafka trigger commands.

## 2. Locks are for consistency the user was promised, not for convenience

DDIA chapter 7: row locks serialize; the cost is paid by every other writer of that row for the whole lock duration. Chapter 8: a process can pause (GC, network, Lambda cold start) at any line, so "it only holds the lock for a millisecond" is never true.

| Smell                                                                                                                     | Move                                                                                                                                                                                                                                     | Check                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Any awaited network call (HTTP, LLM, queue add, publish, Lambda) reachable from inside `$transaction` or an advisory lock | **Split Phase**: prepare (all reads and network) → lock → write only database statements → commit → publish/enqueue. If the write needs a value from the network, fetch it first and re-validate the precondition inside the lock        | Architecture test that walks awaited calls from lock callbacks to outbound clients; shrink-only baseline |
| A lock helper that runs the callback on a second connection                                                               | Take the lock inside the transaction that does the write (`pg_advisory_xact_lock` on the `tx` client), so one connection is held, not two                                                                                                | Ban the two-connection helper once callers migrate                                                       |
| A row shared by every run of a workflow (workflow row, snapshot row, a counter) updated per run or per step               | Do not tune it; remove the shape. Derive the count at read time from the replica, or write a per-run/per-chunk row and aggregate later                                                                                                   | Review checklist; the hot-row list in the domain doc                                                     |
| `SELECT … FOR UPDATE` on the parent row to serialize children (join arrival, concurrency slots)                           | Accept it only when the user-visible promise needs it (a join must fire once). State the per-run serialization in the PR; look for a child-row or counter-column design first                                                            | PR states the lock scope and the promise that justifies it                                               |
| Claiming work with `FOR UPDATE` and letting workers queue on each other                                                   | `FOR UPDATE SKIP LOCKED` for claims; losers move to the next row instead of waiting                                                                                                                                                      | Query shape in code review                                                                               |
| Admission control as "count rows, compare to limit, insert" inside one transaction                                        | This is write skew (chapter 7): two transactions both see room. Either accept slight over-admission and do the count outside the transaction, or make the limit a unique constraint or a single `UPDATE … WHERE count < limit` statement | Document which one you chose; a test with two concurrent admitters                                       |

## 3. Postgres is commit-bound; Valkey is single-threaded

Chapter 7 again, plus operational fact: the hot store's ceiling is commits per second, not rows per second. Many small transactions cost more than one larger one. The queue broker cannot be scaled by instance size.

| Smell                                                             | Move                                                                                                                             | Check                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Four separate `UPDATE`s to the same step row during one job       | Carry the values forward and write them once with the status change; or batch them into the final transaction                    | Query-count budget per scenario, shrink-only                |
| A loop of `await create(...)` per entry                           | `createMany` per chunk; one transaction per chunk, not per entry                                                                 | Query count per N entries is O(1)                           |
| Reading a row the job already has in hand ("re-fetch to be safe") | Pass the row in; re-read only inside a fenced write when a precondition matters                                                  | Query-count budget                                          |
| A queue op per entry (publish per entry, `add` per entry)         | `addBulk`; coalesce events per batch; publish one `runs_created` with the ids                                                    | Per-step queue ops stated in the PR                         |
| An interactive transaction that loops and awaits inside it        | Compute the full set of statements first; the transaction holds only the writes (`$transaction([...])` array form when possible) | Transaction duration in the PR; no loop inside the callback |

## 4. Replication lag is a feature of the architecture, not a bug in the reader

Chapter 5: an asynchronous replica is eventually consistent. Read-your-writes and monotonic reads are guarantees you build, not ones you get.

| Smell                                                                                | Move                                                                                                                                                      | Check                                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A list, aggregate, search, dashboard, or health check reading the primary            | Read the replica (ClickHouse projections) and dedupe row versions; the primary is for the row the user is editing right now                               | Replica-client import allowed only in read-model modules         |
| A read-after-write against the replica, or a retry-until-present loop                | Overlay: read the replica for the bulk, the primary for rows newer than a freshness window, union by id. Or carry the written value forward to the caller | Test with a stale replica                                        |
| Replica reader hard-codes a version column or tombstone name from one CDC generation | Go through the source resolver; the generation can switch under a flag                                                                                    | Grep rule on raw `_peerdb_*`/`_lsn` names outside the resolver   |
| Writing to the replica from application code                                         | Never; CDC and materialized views own it. A read model that needs a different shape gets a materialized view, not an application writer                   | No replica client with write capability outside backfill scripts |

## 5. Publish after commit; repair with a reconciler, not with retries inside the lock

Chapter 11 (change data capture, the outbox idea) and chapter 12 (derived data, dataflow). An event emitted before the commit lands can describe a state that never existed; an event lost after commit can be repaired by anything that can read the database.

| Smell                                                              | Move                                                                                                                                                                         | Check                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `emit(...)` or `forget(emit(...))` inside the transaction callback | Return the events from the unit of work and publish them after `commit` returns                                                                                              | The lock-I/O architecture test treats publishers as outbound |
| Enqueue of the next job inside the transaction that creates it     | Insert the row with a deterministic id in the transaction; enqueue after commit; a periodic reconciler re-enqueues pending rows whose job is missing                         | Reconciler test: pending row with no job gets a job          |
| Event payload carries the whole row to every subscriber            | Event notification (ids and the changed status) to broad rooms; event-carried state only to the subscriber that cannot read it back                                          | Payload size in the PR                                       |
| The replica's lag drives business logic ("is it done yet?")        | Business decisions read the primary row they own; the replica drives display and candidate selection (the reconciler selects from the replica and re-reads from the primary) | Review                                                       |

## 6. Leases, heartbeats, and deadlines instead of long-held locks

Chapter 8: you cannot know whether a worker is dead or slow. A lease with an expiry plus a fencing token lets a second worker take over safely; a lock held across a network call cannot.

- Long-running work (sandbox execution, LLM call, chunk processing) runs **outside** any transaction, on a claim: `claimed_by`, `claim_expires_at`, a generation. Heartbeat extends the claim; the write-back is fenced by the generation.
- Waiting on an external callback gets a `deadline_at` and a pending kind so a reconciler can expire it by class.
- A heartbeat that is itself a transaction per tick is a hot-path cost; batch or lengthen it.

Check: the state table (`STEP_TRANSITIONS`-style) lists which status carries a lease and which carries a deadline; the reconciler handles each class.

## 7. Derived data must declare its source of truth

Chapter 12: when the same fact is stored twice, one copy is authoritative and the other is derived; if neither is declared, both will be written and they will disagree.

| Smell                                                                    | Move                                                                                                                  | Check                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A status column and a `state.status` JSON key kept "in sync" by hand     | Column is authoritative; stop writing the JSON copy (expand/contract); readers use the column                         | Schema annotation `derived` / `deprecated dual-write`; catalog test |
| The same payload stored in four places on insert                         | Store once; derive the others at read time or carry them in memory                                                    | Row-size and query-count budgets                                    |
| JSON-path predicates (`settings->>'workflowId'`) on a column that exists | Query the column; backfill then drop the JSON key                                                                     | Grep rule on the JSON path                                          |
| Counters maintained by increment per event                               | Recount from the replica or from child rows; if a live counter is required, make it per-shard (per chunk) and roll up | Hot-row list                                                        |

## What to write in the PR

For any change on a hot path, five lines: commits added per run/step, queue ops added, publishes added, locks taken and the promise that needs each, and how a retry of the job is idempotent. Reviewers compare those lines to the budget; the records skill copies them into the area record.
