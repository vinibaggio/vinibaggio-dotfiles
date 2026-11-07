---
name: software-design
description: USE THIS for every code review (PR reviews, stack reviews, "help me review", "review pr://N"), alongside `review-style`, and before designing a change that adds a module, splits a large function, introduces a new kind of thing (node, trigger, handler, variant), or touches concurrency (locks, transactions, queues, retries, replicas). Turns the design books the team works from into moves with checks. Not for feature-level product questions.
---

# Software design for coding agents

The team's design canon, distilled into moves an agent can apply and checks that catch regressions. Sources: Designing Data-Intensive Applications (Kleppmann), Software Architecture: The Hard Parts (Ford, Richards, Sadalage, Dehghani), Design Patterns (GoF) read through a functional lens, Working Effectively with Legacy Code (Feathers), Refactoring 2nd edition and the refactoring catalog (Fowler), and the martinfowler.com architecture guide. Nothing here restates a book; each reference maps a source to the smells this repo has and the move that fixes them.

Domain skills specialize this one. For Terracotta, read `docs/workflows/DESIGN.md` after this file; it names the invariant, the precedent in code, and the check for every rule below. For anything that touches a database (schema, migration, query, index, ClickHouse table, Redis key or queue), also load `database-design`: this skill owns transaction and lock shape, that one owns the database itself and the engine versions production runs.

## The bar for a design recommendation

A recommendation is a finding only when it names all three:

1. **Smell**: what in the code or design is wrong, with a file or a shape ("one `switch` on `nodeType` per concern", "HTTP awaited inside `$transaction`").
2. **Move**: the named refactoring or pattern that fixes it (`references/refactoring.md`, `references/patterns.md`), with the first step.
3. **Check**: what would fail if someone undid it tomorrow: a type (`satisfies Record<…>`), a test, a lint rule, an architecture test, or a ratchet baseline. A rule with no check is a doc sentence, and agents drop doc sentences from context. Say `(unenforced)` when that is the truth.

"Follow SOLID", "keep it simple", "add error handling" are not findings.

## Design procedure

Run this before writing code for any change that is not a one-line fix. Write the answers in the plan or the PR description; the answers are what reviewers and the records skill consume.

1. **Name what must stay true, and in which load regime.** Which invariant does the change protect or risk (one writer per row, idempotent retry, publish after commit, exhaustiveness over a union)? Does the code run once per user action, once per run, or once per step? Per-step code is multiplied by six figures per minute; see the domain doc for the numbers.
2. **Find the seam.** Where can the new behavior attach without editing the large thing (`references/legacy-code.md`)? Prefer sprouting a new function or module and calling it from one line over growing a 2,000-line function by 80 lines.
3. **Decide the data story before the code story** (`references/data-intensive.md`): who owns the write, how a retried job stays idempotent (deterministic id, fence, `skipDuplicates`), what is read under a lock and what is read from a replica, and what gets published and when (after commit).
4. **Shape variation as data, not branches** (`references/patterns.md`): a new kind of thing becomes an entry in an exhaustive table, not a new arm in every `switch`. If the table does not exist yet, create it with the two existing kinds plus yours; do not add a third arm.
5. **Pick the smallest reversible shape** (`references/architecture.md`): additive column, new procedure beside the old, flag with a kill switch, expand/contract. Name the deploy order when two services or the CLI are involved.
6. **Wear one hat per PR** (`references/refactoring.md`): a refactoring PR changes structure and no behavior; a feature PR changes behavior against the new structure. Reviewers can verify each; they cannot verify both at once.
7. **Put the check in.** Every "never" you introduce becomes a type, a test, a lint rule, or a baseline entry in the same PR. If the check cannot be written, say why and tag the rule `(unenforced)`.
8. **Write the why.** The PR description carries the invariant, the alternative you rejected, and the check. That text is what the architecture records are generated from.

## Which reference, by task

| You are about to                                                       | Read                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Add a lock, a transaction, a retry, a queue job, a replica read        | `references/data-intensive.md`                                |
| Split a service, move a table's owner, define a cross-service contract | `references/architecture.md`                                  |
| Add a new kind of thing, or a boolean/mode parameter to a shared thing | `references/patterns.md`                                      |
| Change code you do not have tests for, or a function over ~300 lines   | `references/legacy-code.md`, then `references/refactoring.md` |
| Clean up while you are there                                           | `references/refactoring.md` (and do it in its own PR)         |
| Review a design or a PR for any of the above                           | all of the above, then the output format below                |

## Review output

When asked to review a design or diff against this skill:

```
## Design review

{one sentence: what the change does and which invariant it touches}

### Findings

**high** · `path:line` · smell
> Move: {named refactoring or pattern, first step}.
> Check: {type / test / rule / ratchet that would catch regression, or "(unenforced): why"}.
```

Order by blast radius: data-integrity and hot-path cost first, structure second, naming never (linters own that). Say when a lint rule or architecture test already catches the issue; that is the most useful line for the author. Do not flag code the diff does not change. If there are no findings, one line.

For a prose proposal with no diff, replace `path:line` with `shape:` plus the proposal item ("shape: `last_completed_run_id` on `tc_workflows` written per run (item 2)"), and point the Move at the precedent file the domain doc names.

## House positions

Decisions the team has already taken; do not relitigate them in reviews or designs.

- Static exhaustive maps (`as const satisfies Record<Union, …>`) over runtime `register()` calls. A missing entry is a compile error, not a startup error.
- Exceptions carry errors (`TerracottaError`, domain error classes), not `Result` types. Use a discriminated union when the caller must branch on outcome kinds that are not errors.
- Transactions sit at the bottom of the stack and contain only database statements. Prepare before, publish and enqueue after commit.
- Idempotency comes from deterministic ids and fences, never from `updateMany` with a status predicate or from "check then write" without a lock.
- Replica reads (ClickHouse, read models) for lists, aggregates, search, and health. Primary reads only where the user is promised to see their own write.
- Refactoring and behavior change ship in separate PRs. Large functions shrink by extraction behind their existing call sites, never by rewrite.
- Architecture is enforced by types, tests, lint rules, and shrink-only baselines. Prose explains why; it does not enforce.
