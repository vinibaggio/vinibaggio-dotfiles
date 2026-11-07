---
name: evidence-first-debugging
description: Evidence-first root-causing method for any bug, regression, incident, flaky behavior, or "why is X happening" question, and for auditing someone else's (or an agent's) root-cause claim or bug-fix PR. USE THIS whenever debugging or root-causing, before proposing a fix, or when asked "is this the right fix?". Facts before code, a control vs a variable, a hypotheses-by-facts matrix, citations for every claim. Composes with data-source skills (debug, datadog-mcp-bug-investigation, sentry-bug-investigation, devin-bug-investigation, clay-log-analysis, logsgrep, database-access, eppo-overrides); those say WHERE to get facts, this says HOW to reason over them.
---

# Evidence-first debugging

Adapted from Cindy Sridharan, "How to effectively debug when you no longer understand the code" (2026-10). Core idea: code tells you what *can* happen, not what *did*. Root-cause by finding the one hypothesis that satisfies **every** gathered fact, not the most plausible story.

## Hard rules

1. **Facts before code.** Do not form a hypothesis from reading source. Gather facts first. Code is read last, to confirm a mechanism the facts already point to, and you must name the snapshot (branch/sha/deployed version) you read.
2. **Facts are immutable.** You may analyze facts or request more. You may not reinterpret a fact away. If a fact looks wrong, say how it may have been gathered wrong (host, time window, env, version, tool) and re-gather it; do not discard it.
3. **Every claim cites a fact.** Log line + timestamp, trace/span ID, query + result, metric + window, file:line at a named sha, flag value. A claim without a citation is dropped, not softened.
4. **A hypothesis survives only if it satisfies all facts**, including the noise. One contradicting fact kills it.
5. **No fix until Step 3 passes.** A proposed fix must name the fact it makes go away and how you will observe that.
6. **Production access needs explicit user permission** (repo AGENTS.md). Read-only, scoped, `statement_timeout` on DB queries. Live-state sources (DB rows, Redis) cannot explain a past incident.

## The loop

### Step 0: Open the ledger

Before any tool call, write the ledger skeleton (format below) with the facts already in hand: the report, ticket, repro steps, versions, first-seen time, flags, who is affected and who isn't. Facts from the bug report are constraints. Agents most often fail by ignoring constraints they were already given.

### Step 1: Control vs variable → high-fidelity signals

Name both explicitly:

- **Variable**: the failing case.
- **Control**: ideally identical except for the suspected cause. Options, best first:
  - same thing with the flag off / last good version / previous deploy
  - affected vs unaffected workspace, user, shard, region, browser
  - a **sad-path control**: a case that also fails, but loudly and for a known reason (e.g. a real permission error vs the silent hang). Often already present in the data and cheapest to get.
- State why you believe the control is not broken the same way. If you can't, it's not a control.

Diff the two. A data point present in the variable and absent in the control is a **signal**. Present in both is **noise**: it can't say where to look, but it can eliminate hypotheses, so keep it in the ledger. Prefer countable differences (rows, calls, retries, lookups, bytes, frames, durations): arithmetic steers better than narrative.

Gather the same kind of fact from multiple instances of the bug when possible. A pattern that repeats across instances and is missing from the control is real.

### Step 2: Strong signal → most promising hypothesis

List plausible hypotheses (cheap, don't pursue them yet) and build the **hypotheses-by-facts matrix**.

- **Read by column** to rate signals: a signal satisfied by many hypotheses is **weak** (SLO/SLI symptoms like P99, error rate, "it's slow" almost always are). A signal satisfied by one is **strong**. Pursue the hypothesis the strongest signal points to.
- **Read by row** to check fit: a valid hypothesis has no ✗.

If no row is all ✓, apply in order, before inventing anything new:

1. **Re-verify gathering** of the contradicting fact (wrong host, window, env, version?).
2. **Split** coarse hypotheses ("the deploy did it" → each change in the deploy separately).
3. **Merge** over-fine ones (per-host explanations for an AZ-wide symptom → "something common to all").
4. **Combine** complementary ones that each explain different facts without contradicting any. For a combined hypothesis, every cause must be necessary: removing it must leave some fact unexplained.
5. **New hypothesis**, derived only from existing facts.

If every signal is weak or every row still has an ✗: **do not brainstorm more hypotheses. Descend a layer** (below) and return to Step 1.

### Step 3: Validate against every fact

Check the candidate against the entire ledger, noise included, and record ✓/✗ per fact with citations. Then run a **falsification review**: a subagent (or a fresh pass) whose only job is to find one fact that contradicts the hypothesis, check whether any listed signal also appears in the control, and audit how each fact was gathered. Confirmation from a reviewer with the same context is one opinion counted twice; only contradiction counts.

## Progressive signal discovery

Start where facts are cheapest and descend only while signals are weak. Stop at the **strongest** signal, not the deepest. Typical Clay layers (use the matching skill for each):

| Layer | Sources | Skill |
|---|---|---|
| 0. Report | ticket, Slack thread, repro steps, screenshots, first-seen, affected vs unaffected | `devin-bug-investigation`, `slack-search`, `xd://linear_get_issue` |
| 1. Change & config | deploys, `git log` between good/bad, PR diffs, Eppo flag state, env config | `eppo-overrides`, `graphite` |
| 2. Aggregates | Datadog metrics, dashboards, monitors (usually weak signals) | `debug`, `datadog-mcp-bug-investigation` |
| 3. Raw events | Datadog logs/APM traces, Sentry events, session replay, ClickHouse | `datadog-mcp-bug-investigation`, `sentry-bug-investigation`, `clay-log-analysis`, `clickhouse` |
| 4. State | Postgres/sharded rows, queues, Redis, workflow/run records (live state only) | `database-access`, `debug` |
| 5. Process / runtime | local repro, profiler, heap/CPU, network capture, browser devtools, request/response bodies | `logsgrep`, `playwright` |
| 6. Code | the mechanism, at a named sha, to confirm what the facts already show | — |

## Repros are hypotheses

A repro proves *a* bug exists, not *the* bug. It counts only if it reproduces the **strongest signal** from the real occurrence (same error, frame, query count, packet/call sequence, row state). Signal mismatch → it's a different bug; record it as noise and move on. Do still attempt a repro when the report gives steps, and do it early.

## Auditing an existing root cause or fix PR

When asked "is this the right fix?" or reviewing an agent-authored bug fix:

1. Rebuild the ledger from the **original report**, not the PR description.
2. Check the PR's claimed cause against every reported fact; list any fact it does not explain.
3. Check the PR's evidence: is there a control? Is its repro signal-matched to the report? Are claims cited?
4. Verdict: `explains all facts` / `explains a different bug` / `partially explains (missing: …)`. A fix for a real-but-different bug is still the wrong fix for this ticket.

## Ledger format

Keep this in the conversation (or `local://debug-ledger.md` for long investigations) and update it each step. Present it when reporting findings.

```markdown
## Ledger: <bug title>

**Variable:** <failing case>
**Control:** <comparison case> — not broken the same way because <reason>

### Facts
| # | Fact | Source (citation) | In control? | Kind |
|---|------|-------------------|-------------|------|
| F1 | ... | <log/trace/query/file:line@sha> | no | signal |
| F2 | ... | ... | yes | noise |

### Hypotheses × facts
| Hypothesis | F1 | F2 | F3 | ... | Verdict |
|------------|----|----|----|-----|---------|
| H1 ... | ✓ | ✓ | ✗ | | dead (F3) |
| H2 ... | ✓ | ✓ | ✓ | | candidate |
| **signal strength** (# hyps satisfying) | 1 | 2 | 1 | | |

### Layer log
L0 report → L2 aggregates (weak: F1 fits all) → L3 traces (strong: F4) ...

### Status
<candidate / validated / blocked on fact Fn> — next: <the one action that most reduces uncertainty>
```

## Reporting

Lead with the verdict and the strongest signal. Then the matrix, then the fix and the fact it will make disappear. When there are multiple viable fixes with different tradeoffs (e.g. disable the new cache vs make the state machine re-entrant), present them to the user to choose; don't pick silently. List every human intervention that was needed (a control, a constraint, a pushback) as a gap at the end: each one is a missing tool or data source worth fixing.
