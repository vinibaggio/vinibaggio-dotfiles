---
name: plans
description: The ai-docs plan lifecycle — where every design, spec, implementation plan, investigation, or runbook is written and how it moves through drafts/ → next/ → open/ → done/ or discarded/, with parked/ for plans on hold. Use before writing or saving any plan-shaped document, when asked where a plan lives, when promoting or filing a plan, and as the shared contract behind /plan-sync and /plan-status.
user_invocable: true
---

# ai-docs plans

Every design, spec, implementation plan, investigation, profiling worksheet,
runbook, and review writeup is a **plan**, and every plan lives in
`~/code/ai-docs/` (override with `$AI_DOCS_ROOT`). Never inside a product
repository, never in a commit, unless explicitly asked otherwise.

Human-facing copy of these rules: `~/code/ai-docs/README.md`. Keep the two in
agreement when either changes.

## The six folders

| Folder | Means | Leaves when |
|---|---|---|
| `drafts/` | Started, not executable yet: open questions, no task decomposition, unverified assumptions. | Executable as written → `next/` |
| `next/` | Refined, ready to execute. Nothing started. | Execution starts or first PR opens → `open/` |
| `open/` | In execution: PRs open, or awaiting review, CI, or a follow-up pass. | Every linked PR landed → `done/` |
| `parked/` | Worth keeping, deliberately on hold: nobody is refining or executing it. Only on the user's say-so. | The user resumes it → `drafts/` or `next/` |
| `done/` | Shipped. Every linked PR merged, or the goal was met without PRs. | Terminal. |
| `discarded/` | Abandoned, superseded, or answered without action. | Terminal. |

- A plan is in exactly one folder, and **the folder is the truth**. Frontmatter
  `status` mirrors it.
- Root level is **unfiled** — a plan sitting at root has not been triaged yet.
  The one exception is `artifacts/` (below), which is not part of the lifecycle.
- The backwards moves are `open/ → next/` (execution abandoned, plan still
  worth doing) and `parked/ → drafts/` or `next/` (resumed). Any non-terminal
  plan can be parked, but only on explicit instruction, and a parked plan moves
  only when the user resumes it. Terminal folders reopen only on explicit
  instruction.

## Writing a new plan

1. Pick the folder by honest state, not optimism. A plan you just drafted in
   conversation goes to `drafts/` unless it already has task decomposition,
   verified file scope, and acceptance criteria — then `next/`.
2. Path: `<folder>/YYYY-MM-DD-<slug>.md`, date = creation date, and it never
   changes when the plan moves.
3. Artifacts (scripts, SQL, JSON dumps, diffs, screenshots) go in a plan
   directory: `<folder>/YYYY-MM-DD-<slug>/` with `plan.md` (or `design.md`) plus
   the artifacts beside it. An artifact belonging to no single plan — an export,
   a price sheet, a branch dump — goes in `artifacts/`, which sits outside the
   lifecycle and never moves. Never leave a loose artifact at root.
4. Start the file with frontmatter:

```yaml
---
status: drafts
created: 2026-09-11
updated: 2026-09-11
repos: [clay-run/clay-base]
prs: []
tickets: [WOR2-1285]
waiting_on: me
next_action: Decide whether task 2 needs the jemalloc switch before staging.
---
```

| Field | Rule |
|---|---|
| `status` | One of the six folder names. Must equal the containing folder. |
| `created` / `updated` | `YYYY-MM-DD`. `updated` changes on every meaningful edit or move. |
| `repos` | `owner/repo` entries. First entry resolves bare `#123` refs. |
| `prs` | Every PR this plan produced, as a URL or `owner/repo#123`. **Load-bearing** — `/plan-sync` and `/plan-status` classify from these. A PR mentioned only in prose is untracked. |
| `tickets` | Linear keys, e.g. `WOR2-1285`. |
| `waiting_on` | `me` \| `reviewers` \| `ci` \| `user` \| `none`. |
| `next_action` | One line: the next concrete step. |
| `confirmed` | `YYYY-MM-DD`. Only on `done/` or `discarded/` plans: the outcome was ratified by the user, so `/plan-sync` stops asking about it even when the PRs look ambiguous (e.g. a stack where one PR was closed unmerged). Set it with the mover's `--confirm`, never by hand, and only on the user's say-so. |

## Moving a plan

Always use the mover — it renames, sets `status`, bumps `updated`, and creates a
frontmatter block when the plan has none. With the destination equal to the
current folder it updates metadata in place, which is how a terminal outcome
gets ratified:

```bash
node ~/.agents/skills/plans/scripts/plan-move.mjs <plan-path> <folder> \
  [--pr clay-run/clay-base#49609] [--waiting-on reviewers] [--next-action "..."] \
  [--confirm] [--rename <name>] [--dry-run]
```

`<plan-path>` is the `.md` file for a file plan and the directory for a
directory plan; passing a directory plan's `plan.md`/`design.md` moves the
whole directory.

Hand-`mv` only when the mover cannot express the move (e.g. splitting one plan
into two); then fix frontmatter in the same turn.

When you open the first PR for a plan, move it to `open/` and record the PR in
`prs` in the same step. An `open/` plan with no tracked PR is a reporting hole.

## Reading the tree

```bash
node ~/.agents/skills/plans/scripts/plan-index.mjs [--pretty] [--no-gh] [--folder open]
```

Read-only JSON: per plan the folder, frontmatter, tracked PR refs with live
GitHub state, `suggestedFolder`, `needsUser`, `reasons`, `waitingOn`; plus
`artifacts` (loose files that still need an owner), `artifactStore` (the contents
of `artifacts/`, never classified), warnings, and a summary. `--no-gh` skips
GitHub for a fast structural pass. This is the single source both `/plan-sync`
and `/plan-status` consume — do not re-derive plan state by hand.

## History and the Notion mirror

- `~/code/ai-docs` is a local git repo (no remote). Commit after a batch of
  plan work or a `/plan-sync`. Query output (`*.csv`, `*.tsv`, `*.jsonl`,
  `*.gz`) is gitignored: it's large, regenerable from the tracked SQL, and full
  of workspace ids.
- The Notion database "Workflows plans", under Vinny's notes in Workflows Team / Eng Hub (team-visible), is a
  one-way, read-only mirror for humans, refreshed by `/plan-sync` step 5 (`scripts/plan-mirror.mjs` +
  `scripts/plan-mirror-apply.py`). Never edit plans in Notion; ai-docs wins.

## Graphite merge queue

A landed PR reads `state: CLOSED` with `mergedAt: null` and carries the
`externally-merged` label; the queue never marks it merged. The indexer applies
this rule (`landedViaQueue: true`). Never conclude "closed without merging" from
`state` alone — check the label, and if it has not landed yet, look for the
squash commit `<PR title> (#<number>)` on `dev`.

## Never

- Write a plan into a product repo, or commit one there.
- Leave a new plan at root "for now" — file it.
- Claim a plan is done without its PRs actually landed.
- Invent a `prs` entry from a prose mention; verify the number first.
