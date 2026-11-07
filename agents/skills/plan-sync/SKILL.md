---
name: plan-sync
description: Reconcile the ai-docs plan folders with reality — move plans whose PRs landed to done/, plans with open PRs to open/, confirm discards for PRs closed without merging, and triage unfiled plans at root. Use when asked to sync plans, tidy ai-docs, file plans, or after a batch of PRs merged.
user_invocable: true
---

# /plan-sync

Make `~/code/ai-docs/` folders match what actually happened. Read the `plans`
skill first for the lifecycle contract; this skill is the reconciliation
procedure only.

Invariant: **you move plans, you never edit their prose.** Frontmatter changes
come from the mover script.

## 1. Index

```bash
node ~/.agents/skills/plans/scripts/plan-index.mjs --pretty > /tmp/plan-index.json
```

If `warnings` contains `gh lookup failed`, fix auth (`gh auth status`) before
classifying — a 404/401 must never be read as "closed without merging".

## 2. Apply the unambiguous moves

For each plan with `move` set and `needsUser: false`, run the mover. These are
the only moves you make without asking:

| Observed | Action |
|---|---|
| Every tracked PR landed (`merged`, including `landedViaQueue`) | → `done/` |
| Any tracked PR still open | → `open/` |
| Frontmatter `status` disagrees with the folder (`statusMismatch`) | Re-run the mover into the **current folder** to correct `status` |

```bash
node ~/.agents/skills/plans/scripts/plan-move.mjs \
  ~/code/ai-docs/<current>/<plan> done --next-action "none — shipped"
```

Batch these; report them as a single list, not one message per file.

## 3. Ask about everything else

Group the questions — one round, not one per plan. Ask when:

- **All tracked PRs closed without merging.** Default suggestion `discarded/`,
  but the plan may be worth re-doing (`next/`) or may have landed by other means.
  Never auto-discard: a closed PR is often a resubmitted stack.
- **Mixed outcome** — some landed, some closed unmerged. Usually `done/` with the
  dropped task noted in `next_action`; confirm.
- **`open/` with no tracked PR.** Either add the PRs to frontmatter (`--pr`) or
  move it back to `next/`.
- **Unfiled plans at root** with no tracked PRs — the folder cannot be inferred.
  Batch these by reading each plan's first 30 lines and proposing a folder per
  plan (`drafts` for open questions / no task list, `next` for executable,
  `done` for finished investigations and runbooks, `discarded` for superseded).
  Present the proposal as a table and apply what the user confirms.
- **A PR ref could not be read** (`status: unknown`) — deleted, renamed repo, or
  a private repo the token cannot see.

**Record every answer with `--confirm`.** A terminal outcome the user ratified
gets `confirmed: <today>` stamped, and the indexer stops flagging it. Without
that stamp the same question returns on every sync:

```bash
node ~/.agents/skills/plans/scripts/plan-move.mjs <plan-path> done --confirm \
  --waiting-on none --next-action "shipped; the task behind #43064 was intentionally dropped"
```

Destination equal to the current folder updates in place — use that when the
answer is "it's already in the right folder". `--confirm` is rejected for
`drafts/`, `next/`, `open/`, and `parked/`: a plan still in motion or on hold has no outcome to ratify.
Never stamp it on your own inference.

For `mentions` (bare `#123` seen in prose but not tracked): verify each with
`gh pr view <n> --repo <repo> --json number,title,state` before proposing it as
a `prs` entry. Prose numbers are frequently Linear IDs, line numbers, or issues.

## 4. Tidy structure

- **Loose artifacts** (`artifacts[]`: `.sql`, `.csv`, `.json`, `.py`, `.txt`,
  `.diff` sitting at a folder root): fold each into the plan directory it belongs
  to, or a new `YYYY-MM-DD-<slug>/` bundle. When no single plan owns it, move it
  to `artifacts/` — the out-of-lifecycle store for standing artifacts. Ask before
  attributing one to a plan; that association is a judgement call. Moving an
  unowned artifact to `artifacts/` needs no confirmation.
- **`artifacts/` itself** (`artifactStore[]`): never classified, never moved,
  never filed. Report the count only.
- **Legacy nesting** (e.g. an old `plans/` directory, or a dated directory that
  is really one doc plus assets): propose flattening into the lifecycle layout.
- **Plans missing frontmatter**: the mover adds it on the next move. Do not
  hand-add frontmatter to plans you are not moving unless asked.

## 5. Mirror to Notion

ai-docs is the source of truth. The Notion database "Workflows plans", under
[Vinny's notes](https://app.notion.com/p/40f7e66eb014818293c4c492e58829d3) in
Workflows Team / Eng Hub (visible to the team), is a read-only mirror for humans: one row per plan, the main file
as the row's page, supporting `.md` files as subpages. Only what changed since
the last sync is pushed; `<root>/.notion-mirror.json` records page ids and
content hashes.

```bash
node ~/.agents/skills/plans/scripts/plan-mirror.mjs plan --out /tmp/mirror-plan.json
```

Apply it from an omp eval (Python) kernel, then record what landed:

```python
%load ~/.agents/skills/plans/scripts/plan-mirror-apply.py
summary = await apply_mirror("/tmp/mirror-plan.json", "/tmp/mirror-results.json")
```

```bash
node ~/.agents/skills/plans/scripts/plan-mirror.mjs record \
  --plan /tmp/mirror-plan.json --results /tmp/mirror-results.json
```

- Run this after the moves, so the mirror shows the new folders.
- Failed ops (`summary["errors"]`) aren't recorded and are retried on the next sync.
- `summary["trash_pending"]` lists rows or subpages whose source no longer
  exists (a renamed or deleted plan). Notion requires the user to confirm
  deletions: show the list, and only after they agree re-run
  `apply_mirror(..., confirm_trash=True)` with a fresh plan file.
- Notion 401 means the session expired: stop and ask the user to run `/notion`.
- Never edit the mirror in Notion, and never pull Notion edits back.

Then commit the tree: `git -C ~/code/ai-docs add -A && git -C ~/code/ai-docs commit -m "plan-sync <date>"`.
Query output (`*.csv`, `*.tsv`, `*.jsonl`, `*.gz`) is ignored on purpose.

## 6. Report

One block, in this order:

1. **Moved** — `<plan>: <from>/ → <to>/ (reason)`.
2. **Asked and applied** — the user's decisions you executed.
3. **Left alone** — plans already correct, with the count only.
4. **Needs you** — anything still unresolved, with the exact question.

Then the new folder counts (`summary.byFolder` from a fresh index run) so the
final state is verified, not asserted, and the mirror result: rows created,
updated, and anything pending trash or failed.

## Never

- Move a plan out of `done/` or `discarded/` without explicit instruction.
- Move a plan into or out of `parked/` without explicit instruction.
- Treat `state: CLOSED` as unmerged without checking the `externally-merged`
  label or the squash commit on `dev` (Graphite fast-forwards the queue).
- Delete a plan. Discarding is a move to `discarded/`.
- Rewrite plan prose, reformat, or "clean up" a plan while syncing.
