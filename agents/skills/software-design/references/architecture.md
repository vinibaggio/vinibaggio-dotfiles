# Architecture: trade-offs, boundaries, and what counts

Sources: Software Architecture: The Hard Parts (trade-off analysis, granularity, data ownership, contracts, reuse, sagas, fitness functions) and the martinfowler.com architecture guide (what architecture is, presentation-domain-data layering, CQRS and event patterns, feature toggles, evolutionary design, internal quality).

## 1. What is architectural here

Fowler, via Ralph Johnson: architecture is the shared understanding expert developers have of the design, and the decisions you wish you could get right early because they are expensive to change. In this repo that set is short and concrete:

- Which store owns which fact, and which copies are derived (Postgres primary vs ClickHouse replica vs JSON blobs).
- Where transactions and locks may live, and what may happen inside them.
- The cross-service and CLI-visible contracts, because an installed CLI binary never redeploys.
- The exhaustive unions that every surface branches on (node type, trigger type, step status).
- Per-run and per-step cost, because production multiplies it by six figures a minute.

Everything else is design, and design is cheap to change. Spend review attention proportionally. A naming debate in a hot-path PR is a wasted review; a new `FOR UPDATE` on a shared row in a "small" PR is the architectural event.

Internal quality pays back in weeks, not quarters (Fowler, "Is high quality software worth the cost"). Cruft in the hot path is not a future problem; the next partner team pays it on their first PR.

## 2. Trade-off analysis, the Hard Parts way

There are no best practices for the hard parts, only trade-offs. The book's method, cut to what fits a PR description:

1. **Find the entangled dimensions.** Name the two or three forces that pull against each other (consistency vs lock duration; one table vs two services; strict contract vs independent deploys).
2. **Analyze how they are coupled.** For each option, what gets worse when it gets better: "deterministic ids make retries free but force the id to be computable before the insert".
3. **Decide with the context in the sentence.** "We chose X because this path runs 1,600 times a second" ages well; "X is best practice" does not.

Avoid out-of-context trade-offs: a pattern that was right for the authoring path (locks are fine, volume is tiny) is wrong for the step path. State which regime a decision is for.

Write the result as options with pros, cons, mitigation, and the vote. That is what the PR description's "Goal of this change" is for; the architecture records are generated from it.

## 3. Granularity: when to split and when not to

Hard Parts gives disintegrators (reasons to split) and integrators (reasons to keep together). Use them literally.

| Split a module or service when                                                          | Keep it together when                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The two halves scale differently (authoring at human speed, execution at 100k runs/min) | They need one database transaction to be correct (run + initial steps are created atomically) |
| One half changes weekly and the other quarterly (code volatility)                       | They share a workflow that would become a saga with compensation across the split             |
| A fault in one must not take down the other (sandbox execution vs the API)              | They share data with a relationship a join expresses and a network call cannot                |
| One half has a different security posture (user auth vs service-to-service only)        | The "shared code" between them is the domain, not a utility                                   |

The precedent: `services/terracotta-service` was split from `apps/api` on scalability, fault tolerance, and security posture; the schema stayed in one lib because the two share transactions. Do not propose a split that puts a transaction across a network boundary; propose it when load regimes or failure domains differ.

Inside a service the same table applies to modules. A 4,000-line service file is not "cohesive"; it is several modules that were never split because nothing forced it. The forcing function is now the file-size and complexity ratchet.

## 4. Data ownership

Hard Parts: every table has exactly one owning service that writes it. Other services read through the owner's contract, a replicated read model, or a cache they do not treat as truth.

- **Single owner.** Write through the owner's module (run creation only through the persistence service; step writes only through the transition helper). Direct writes from elsewhere are the smell, not the exception.
- **Joint ownership is a design failure to resolve, not a state to document.** Options in order of preference: split the table by owner; make one the owner and the other a delegate that calls it; replicate a read-only copy by CDC. The one you choose depends on who needs fresh data.
- **Distributed access.** Prefer a replicated read model (ClickHouse projections, Kafka-fed copies) over synchronous cross-service reads on a hot path. A synchronous read is acceptable at human speed (authoring) and a budget line on the step path.
- **Schema change across owners is expand/contract**: add the new column or procedure, dual-write or dual-serve, migrate readers, remove the old. No deploy ordering makes "drop the column" and "code that selects it" safe in one release.

## 5. Contracts

Hard Parts: strict contracts (shared types, schemas) give safety and couple deploys; loose contracts (open records, string enums) decouple deploys and lose safety. Choose per boundary.

| Boundary                                           | Contract style                                                                                                                  | Why                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Frontend ↔ API, API ↔ internal service (same repo) | Strict: ts-rest and Zod in `libs/api-contract`, tRPC with shared types                                                          | One repo, one deploy pipeline; the compiler is the cheapest reviewer                                 |
| Queue producers ↔ consumers                        | Strict schema, additive evolution: new fields optional first, consumers tolerate unknown fields                                 | Producer and consumer deploy at different times; a message in flight has the old shape               |
| API ↔ installed CLI                                | Strict schema compiled into the binary, so **removing or narrowing is breaking**; adding an enum member or union variant is not | The binary never redeploys; it retries validation against a relaxed schema for unknown variants only |
| Cross-team service boundary (Audiences, ai-runner) | Strict and narrow: the published client, not deep imports; Kafka for writes that need not be read back inline                   | The owning team commits to the published surface only                                                |

Stamp coupling (passing a whole object when the callee reads two fields) is a contract smell: it couples the callee to every field's evolution and inflates payloads on broad channels. Pass what the callee needs, or an id it can resolve.

## 6. Layering, and the direction of dependencies

Fowler's presentation-domain-data layering, applied per surface:

- **Contract / shared**: pure facts and schemas (Zod), importable by every surface, no I/O at all.
- **Domain**: types, state tables, pure graph logic. No I/O at import time, no database client, no queue factory.
- **Services / use cases**: orchestrate; own the unit of work; call repositories for persistence and clients for the outside world.
- **Repositories**: the only code that holds a database client, opens a transaction, or takes a lock. Take and return plain data; never accept a callback.
- **Infrastructure / clients**: Redis, BullMQ, S3, HTTP clients, SDKs. Behind an interface the service layer calls.
- **Entrypoints**: tRPC routers, queue handlers, cron functions, React components. Translate and delegate; no business logic, no database client.

Dependencies point inward. A `domain/` file importing from `services/` is a cycle waiting to happen (and in Terracotta it did: an 80-file cycle cluster). The check is a layer rule in the architecture config plus a cycle detector in diff mode; the doc only says why.

For React: contract types → hooks (data) → registry (variant facts) → components (presentation). A component that calls the API client inline or branches on a scenario it could receive as a registry entry has crossed a layer.

## 7. CQRS and the event patterns, precisely

Fowler names four event patterns; the repo uses three and should name them when designing:

- **Event notification**: "step 123 changed to completed". Small, safe to broadcast to every open tab. Default for streams.
- **Event-carried state transfer**: the event carries the data so the consumer need not read back. Use only for the consumer that cannot read the primary (another service, another team). Payload size is the cost.
- **CQRS**: writes to Postgres, reads from ClickHouse projections. Already the architecture; the rule is that a new list/aggregate/search read goes to the read side, and the write side is not grown to serve a query.
- **Event sourcing**: not used; the step row is the state, the archive is history. Do not propose it for a sub-problem.

## 8. Sagas and eventual consistency

A workflow that spans a transaction boundary (two services, or a database write plus an external call) is a saga whether or not you call it one. Hard Parts' advice in one paragraph: prefer the "parallel saga" shape (asynchronous, eventually consistent, compensating by state machine) over the "epic saga" (synchronous, atomic, orchestrated with distributed locks). In repo terms: write the row in a pending state and commit; do the external call; write the outcome fenced by generation; let a reconciler expire what never came back. Never hold the database transaction open across the external call to make it "atomic".

## 9. Feature toggles are code with a lifetime

Fowler (Hodgson): toggles are release, experiment, ops, or permission toggles; each has a different lifetime, and all add a branch. Rules that follow:

- A release toggle guards a cutover and dies when the rollout completes; name the removal condition in the PR.
- Evaluate a toggle once at the edge (job start, request start), pass the decision down; do not re-evaluate inside a hot loop or inside a transaction.
- A toggle that switches a data shape (two CDC generations, two write paths) needs the reader to handle both until the flag is removed, and a one-way latch when the move cannot be reversed.
- "Assume the rollout completed" when coding, remove the obsolete branch, and tell the user what to verify before landing.

## 10. Fitness functions: how architecture is kept, not described

Hard Parts and Building Evolutionary Architectures: a fitness function is an automated check that an architectural characteristic still holds. This repo's fitness functions are types (`satisfies Record<Union, …>`), architecture tests (lock-I/O reachability, data-layer access, node-type justification), custom lint rules, and shrink-only baselines in diff mode. When you introduce a rule, introduce its fitness function in the same PR. When a rule has none, tag it `(unenforced)` so readers know it is a wish.

## 11. Evolutionary design and sacrificial architecture

Design for the load you have measured and the next order of magnitude, not the one after. A design that will be replaced when the next order of magnitude arrives is fine if the replacement does not require a rewrite of its callers: keep the interface small and the implementation disposable (Fowler's sacrificial architecture). Avoid the opposite failure, too: a "temporary" shortcut on the hot path (a per-step read, a shared-row counter) is architectural because its cost scales with load, and it will be the thing that pages you first.
