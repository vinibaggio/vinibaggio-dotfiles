# Personal instructions

## Communication Style

Default to a short, plain-language answer first (3-5 sentences, no internal jargon), then offer to go deeper. Only produce the long technical version if asked.

## PR Workflow

- Ship work as stacked Graphite PRs (`gt create` / `gt submit`) unless told otherwise.
- Before pushing: run typecheck, lint, and the affected tests. Never use `git push --force`; if a pre-push hook fails due to pre-existing repo breakage, ask before using `--no-verify`.
- Before every push to a PR branch (`gt submit`, `gt ss`, `git push`), including fix pushes for CI or review comments, follow `~/.agents/skills/pre-push-review/SKILL.md`: run an independent code review and a `software-design` review in fresh contexts, plus a `database-design` review when the diff touches a database, and fix or decline every P1 and P2 before pushing.
- After opening a PR, monitor CI and re-run known flakes (e.g. Eppo test timeouts) rather than assuming failure.
- Reply to each reviewer comment (Codex / Codex bot / human) in-thread after addressing it.

## Debugging

- State your hypothesis and the cheapest test for it before writing any fix. If two attempts at a layer fail, stop and re-derive the root cause from data rather than patching the next layer.
- Prefer fixing at the source of truth (shared computation, dashboard config) over instrumenting every callsite.

## Plans (ai-docs)

- Every AI-generated design, spec, implementation plan, investigation, runbook, or review writeup is a **plan**. Plans live in `/Users/vinny/code/ai-docs/` — never inside a repository or in its commits, unless explicitly requested otherwise.
- Plans move through lifecycle folders: `drafts/` (needs refinement) → `next/` (ready to execute) → `open/` (in execution, PRs open or awaiting review) → `done/` (every PR landed) or `discarded/` (abandoned). Root level means unfiled.
- Before writing, filing, or promoting a plan, load the `plans` skill (`~/.agents/skills/plans/SKILL.md`). Use `/plan-status` for what is open and what is blocked on me, `/plan-sync` to reconcile folders with PR state.
- New plans carry frontmatter: `status`, `created`, `updated`, `repos`, `prs`, `tickets`, `waiting_on`, `next_action`. The `prs` list is load-bearing — both plan skills classify a plan from the live state of those PRs.

## Code Review Requests

When asked for a security or code review of a changed file set: start from `git diff` on the changed files, and report findings incrementally as you go. Do not spend more than ~10 tool calls exploring before emitting the first batch of findings. When the diff touches migrations, schemas, SQL/ORM queries, ClickHouse, or Redis/Valkey/BullMQ, load `~/.agents/skills/database-design/SKILL.md` first.

## Database design

Load `~/.agents/skills/database-design/SKILL.md` before discussing or proposing any database design, even before code or a PR exists: where data lives, new tables/columns/indexes, Postgres vs ClickHouse vs Redis, caches, queues, backfills, retention. Also load it before writing a migration or a query on a production table.

## Off-limits paths

- `libs/shared-backend/public-actions` (clay-base): never stage or commit changes here. If drift appears, call it out and leave it unstaged.
