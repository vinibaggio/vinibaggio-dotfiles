# Implementation workflow

Before every implementation task, read `~/.agents/skills/implementation-worktree/SKILL.md`. Never implement in `~/code/clay-base`: create a new dedicated worktree and use Graphite-managed stacks. Continue a task only in its dedicated worktree. Apply this rule to subagents, edits, commands, and verification; use explicit worktree paths/cwd. Do not silently fall back to the primary checkout.

Pass every edit tool an absolute path inside the worktree, never a relative path (relative paths resolve against the session cwd, which is often `~/code/clay-base`). Before running tests, confirm the edits landed there with `git -C <worktree> status`.

# Git hooks

Never skip hooks: no `--no-verify` on `git commit`, `git push`, `gt create`, `gt modify`, or `gt submit`, and no `HUSKY=0` or similar. If a hook fails, root-cause it, tell me what failed and why, and ask before bypassing. Approval covers that one push only; it does not carry over to later pushes or sessions.

# Pre-push review

Before every push to a PR branch (`gt submit`, `gt ss`, `git push`), including fix pushes for CI or review comments, follow `~/.agents/skills/pre-push-review/SKILL.md`: run an independent code review and a `software-design` review in fresh contexts, plus a `database-design` review when the diff touches a database, and fix or decline every P1 and P2 before pushing.

# Database design

Load `~/.agents/skills/database-design/SKILL.md` before discussing or proposing any database design, even before code or a PR exists (where data lives, new tables/columns/indexes, Postgres vs ClickHouse vs Redis, caches, queues, backfills, retention), before writing a migration or a query on a production table, and in every code review whose diff touches migrations, schemas, SQL/ORM queries, ClickHouse, or Redis/Valkey/BullMQ.

# Credentials

When SSO or auth expires (AWS, Datadog, ClickHouse, Notion, gh), stop and ask me to log in again. Never work around it with other profiles, cached tokens, alternate credentials, or the browser.

# Production data

Read-only Datadog and ClickHouse queries, including production, are pre-approved: run them instead of offering to. Before posting a review comment, PR claim, or design-doc number about production behavior, verify it with a query and cite the query and window. Before building a fix for a problem reported by a bot or a ticket, size it with one production query first. Anything that writes to a production system (databases, Knock, Eppo, AWS) needs my approval each time.

These sections apply to subagents too; include them in subagent context.

# Technical writing

Before drafting any technical prose I will publish or post (docs, Notion pages, plans, proposals, incident writeups, long Slack posts, PR descriptions, review comments), read `~/.agents/skills/technical-writing-voice/SKILL.md` and write in that voice.
