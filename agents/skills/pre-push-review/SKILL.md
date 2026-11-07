---
name: pre-push-review
description: Required gate before every push to a PR branch (`gt submit`, `gt ss`, `git push`), including fix pushes for CI or review comments. Runs an independent code review, a `software-design` review, and, when the diff touches a database, a `database-design` review, each in a fresh context, then fixes or declines every P1 and P2 before the push.
user_invocable: true
---

# Pre-push review

No push to a PR branch while a P1 or P2 from any review is open.

## When

- Before the first `gt submit` of a PR.
- Before every later push that adds or changes the branch's own commits: CI fixes, bot-review fixes, human-review fixes.
- Skip only when the push changes no content of the branch's own commits (a restack onto a new parent; `git range-diff <old-parent>..<old-head> <new-parent>..HEAD` shows no changes), or when the user says to skip it for this push. Say which one applied.

Run it after the local gate (tsc, lint, format, tests) is green. Reviewing red code wastes the round.

## 1. Freeze the input

- Commit first (`gt create` / `gt modify`) so the review is pinned to a SHA.
- Base is the Graphite parent (`gt parent`), not `dev`, for a stacked PR.
- First push: review `<base>...HEAD`. Later push: review `origin/<branch>..HEAD` and give the full `<base>...HEAD` diff as context.
- Write the intent in 2-4 sentences: what the change must do and its acceptance criteria, from the task, the plan, or the PR description. Do not include why you think the code is correct.

## 2. Run the reviews in parallel, each in a fresh context

Always run A and B. Run C when the diff touches a database: files under any `migrations*/` or `prisma/` directory, `schema.prisma`, `apps/api/schema*.sql`, ClickHouse `.sql` files, raw SQL or query-builder calls (`$queryRaw`, `$executeRaw`, `knex`, `sequelize.query`, Kysely, `chsql`), ORM entity or model definitions, new or changed queries against a production table, `$transaction`/advisory locks/`FOR UPDATE`, or Redis/Valkey/BullMQ code (keys, TTLs, Lua, locks, queues). When unsure, run it; a database review with nothing to review costs one line.

"Independent" means the reviewer did not write the code and has none of the implementation conversation. Give each reviewer only: worktree path, base, head SHA, intent, and the review brief below. Do not tell it what you already considered, what to skip, or what you believe is fine. Reviewers are read-only: they never edit, commit, or push.

|Harness|How to get a fresh context|
|---|---|
|omp|`task` with one task per review, `agent: "reviewer"`|
|Claude Code|Agent tool, one subagent per review in one message|
|Codex|One subagent per review (`multi_agent`)|
|No subagent tool|One process per review: `claude -p --permission-mode plan "<brief>"` or `codex exec -s read-only -C <worktree> "<brief>"`|

Repo rules for subagents (worktree, hooks, credentials, production data) go into every brief.

**A. Code review brief.** Review the diff for: correctness on realistic inputs; data loss and round-trip fidelity; concurrency, retries, and idempotency; authz and security; error paths; deploy-order compatibility (frontend/backend, queue producer/consumer, DB schema, CLI response fields); tests that fail without the change; files touched outside the stated scope. Flag only what the diff introduces or materially changes. Add any task-specific lenses the caller passes (for example the checklist in `ship-plan` 1b).

**B. Design review brief.** Load `~/.agents/skills/software-design/SKILL.md` and, for Terracotta code, `docs/workflows/DESIGN.md`. Review the diff in that skill's "Review output" format. Every finding names smell, move, and check. Use P levels instead of high/medium/low.

**C. Database review brief.** Load `~/.agents/skills/database-design/SKILL.md` and the references its table names for the surfaces in the diff; for ClickHouse also load the repo skills it names. Check every recommendation against `references/versions.md` for the database the code runs on. Review the diff in that skill's "Review output" format: every finding names smell, engine and version, failure, move, and check. Size claims with read-only production queries (Datadog, ClickHouse) and cite the query and window.

Every reviewer returns each finding as: severity, `path:line`, the concrete failure path (input or sequence, then the wrong outcome), and the fix. If a review has no findings, it says so in one line.

## Severity

- **P1, blocks the push.** Wrong results, data loss or corruption, a security or authz gap, an outage or deploy-order break, a regression on a realistic path, a house-position violation in `software-design` (I/O inside a transaction, idempotency from a status predicate, publish before commit), or a P1 as defined in `database-design` (blocking DDL on a hot table, a feature the production engine version lacks, a dropped column still mapped, a cache treated as source of truth).
- **P2, blocks the push.** A real defect on a narrower but plausible path; changed behavior with no test that fails without it; a design finding whose cost compounds (per-step hot-path cost, a new `switch` arm where an exhaustive table belongs, a new "never" with no check).
- **P3, does not block.** Minor, naming, optional cleanup. List these in the report; do not act on them unless they are free.

The reviewer's severity is a hint. You set the final severity, and you say so when you change it.

## 3. Address every P1 and P2

Verify each claim against the code at the head SHA, and against production data when the claim is about behavior or scale (read-only Datadog and ClickHouse are pre-approved). Then pick one:

1. **Fix.** For a behavior fix, add or adjust a test that fails without the fix.
2. **Decline.** The finding is wrong, already handled, or intended. Write the concrete reason: file, guard, test, or query.
3. **Ask the user.** The fix is a product or scope call, or it is a refactor of code the diff does not touch (that is its own PR, per `software-design` "one hat per PR"). Do not push until the user answers.

No silent drops. "Out of scope" without the user's agreement is not a decline.

## 4. Re-review the fixes

After fixes, rerun the local gate, then rerun every review that ran (and C if the fixes now touch a database) on `<previous reviewed SHA>..HEAD` in fresh contexts. Give each reviewer its open findings from the last round and nothing else from the earlier rounds. Repeat until no P1 or P2 is open.

Cap: 3 rounds. If a P1 or P2 is still open after round 3, do not push. Report both positions to the user.

## 5. Report

Before you push, report one table to the user: round, review (code / design / database), severity, finding (short), action (fixed in `<sha>` / declined: reason / waiting on user). Put P3s after the table. The findings stay in the report; do not post them to GitHub.
