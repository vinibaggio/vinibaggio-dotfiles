# Personal instructions

## Communication Style

Default to a short, plain-language answer first (3-5 sentences, no internal jargon), then offer to go deeper. Only produce the long technical version if asked.

For any technical prose I will publish or post (docs, Notion pages, plans, proposals, incident writeups, long Slack posts, PR descriptions, review comments), load the `technical-writing-voice` skill (`~/.agents/skills/technical-writing-voice/SKILL.md`) and write in that voice.

## PR Workflow

- Implement only in a dedicated worktree (`~/.agents/skills/implementation-worktree/SKILL.md`), never in `~/code/clay-base`. Pass edit tools absolute paths inside the worktree and confirm edits landed there (`git -C <worktree> status`) before running tests.
- Ship work as stacked Graphite PRs (`gt create` / `gt submit`) unless told otherwise.
- Before pushing: run typecheck, lint, and the affected tests. Never use `git push --force`.
- Before every push to a PR branch (`gt submit`, `gt ss`, `git push`), including fix pushes for CI or review comments, follow `~/.agents/skills/pre-push-review/SKILL.md`: run an independent code review and a `software-design` review in fresh contexts, plus a `database-design` review when the diff touches a database, and fix or decline every P1 and P2 before pushing.
- Never skip hooks: no `--no-verify` on `git commit`, `git push`, `gt create`, `gt modify`, or `gt submit`, and no `HUSKY=0`. If a hook fails, root-cause it, tell me, and ask before bypassing. Approval covers that one push only.
- When SSO or auth expires (AWS, Datadog, ClickHouse, Notion, gh), stop and ask me to log in again. Never work around it.
- After opening a PR, monitor CI and re-run known flakes (e.g. Eppo test timeouts) rather than assuming failure.
- Reply to each reviewer comment (Codex / Claude bot / human) in-thread after addressing it. "Address bot reviews" means Codex, Claude, the risk check, and Softlight on every PR in scope; follow `~/.agents/skills/address-bot-reviews/SKILL.md`.

## Production data

Read-only Datadog and ClickHouse queries, including production, are pre-approved: run them instead of offering to. Before posting a review comment, PR claim, or design-doc number about production behavior, verify it with a query and cite the query and window. Before building a fix for a bot- or ticket-reported problem, size it with one production query first. Anything that writes to a production system needs my approval each time.

## Debugging

- State your hypothesis and the cheapest test for it before writing any fix. If two attempts at a layer fail, stop and re-derive the root cause from data rather than patching the next layer.
- Prefer fixing at the source of truth (shared computation, dashboard config) over instrumenting every callsite.

## Plans (ai-docs)

- Every AI-generated design, spec, implementation plan, investigation, runbook, or review writeup is a **plan**. Plans live in `/Users/vinny/code/ai-docs/` — never inside a repository or in its commits, unless explicitly requested otherwise.
- Plans move through lifecycle folders: `drafts/` (needs refinement) → `next/` (ready to execute) → `open/` (in execution, PRs open or awaiting review) → `done/` (every PR landed) or `discarded/` (abandoned). Root level means unfiled.
- Before writing, filing, or promoting a plan, load the `plans` skill (`~/.agents/skills/plans/SKILL.md`). Use `/plan-status` for what is open and what is blocked on me, `/plan-sync` to reconcile folders with PR state.
- New plans carry frontmatter: `status`, `created`, `updated`, `repos`, `prs`, `tickets`, `waiting_on`, `next_action`. The `prs` list is load-bearing — both plan skills classify a plan from the live state of those PRs.

## Database design

Load `~/.agents/skills/database-design/SKILL.md` before discussing or proposing any database design, even before code or a PR exists: where data lives, new tables/columns/indexes, Postgres vs ClickHouse vs Redis, caches, queues, backfills, retention. Also load it before writing a migration or a query on a production table.

## Code Review Requests

For every code review, load `review-style` and `software-design` (`~/.agents/skills/`) before reading the diff. When the diff touches migrations, schemas, SQL/ORM queries, ClickHouse, or Redis/Valkey/BullMQ, also load `database-design`.

When asked for a security or code review of a changed file set: start from `git diff` on the changed files, and report findings incrementally as you go. Do not spend more than ~10 tool calls exploring before emitting the first batch of findings.

Re-resolve the branch head at the start of every review, and again before submitting one: a force-push between reading and submitting turns findings into citations of deleted code.

### Design rules (test drive — personal only, do not propose as a team rule yet)

Check these on every code review, and before opening my own PR. Each rule fires on **distance and multiplicity**, not on a syntactic pattern — apply the stated test rather than judgment, and report the rule name plus the failing test.

1. **Split atomic write.** Fires when an operation needs two or more statements that must co-occur to be correct. Test: *can a caller do half of it and still compile?* If yes, it's a violation. Fix: one function that performs both halves, so the partial form is unreachable.
2. **Duplicated policy.** Fires when the same question is answered from raw discriminants in two or more modules. Test: *how many spellings of this predicate exist, and does anything break if they diverge?* Fix: one named predicate, imported.
3. **Hand-enumerated set.** Fires when the same field or case list is written out more than once. Test: *does adding one member require edits in more than one place?* Fix: one table plus a loop.
4. **Prose-guarded footgun.** Fires when a comment explains how to call something safely, or documents that a type is wrong. Test: *is the unsafe form still callable / is the type still lying?* Fix: wrap the primitive and ban the raw form, or make the type honest. A documented hazard is not a fixed hazard.

**Do not fire these rules on** (without these exclusions the rules generate noise and get ignored): narrowing a discriminated union to access a field; an exhaustive `switch` at a single dispatch boundary where the compiler checks totality; a type check inside the function that owns that behavior; two similar-looking call sites in the same function that are genuinely independent.

For rules 2 and 3, grep rather than eyeball — count the spellings and the enumerations across the diff's modules. When an extraction lands, follow it with a lint rule banning the primitive it replaced, or the extraction decays.

## Off-limits paths

- `libs/shared-backend/public-actions` (clay-base): never stage or commit changes here. If drift appears, call it out and leave it unstaged.
