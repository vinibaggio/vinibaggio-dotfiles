---
name: plan-status
description: Report the state of ai-docs plans — what is in execution, what is blocked on me (CI red, changes requested, draft PR, ready to merge), what is waiting on reviewers or CI, and which plans' PRs have moved since the folder was last updated. Use when asked what's open, what needs my attention, what am I waiting on, or for a plan/PR standup.
user_invocable: true
---

# /plan-status

Answer two questions in one pass: **what is in flight**, and **what is waiting on
me**. Read the `plans` skill for the lifecycle contract.

Read-only. Never move a plan here — if the index shows pending moves, say so and
offer `/plan-sync`.

## 1. Index

```bash
node ~/.agents/skills/plans/scripts/plan-index.mjs --pretty > /tmp/plan-index.json
```

Default scope is `open/` + `next/` + unfiled root plans. Add `drafts/` when asked
for everything; skip `parked/`, `done/`, and `discarded/` unless asked.

If `gh` lookups failed, report the plans as "state unknown" rather than
silently reporting stale folders as truth.

## 2. Classify every open plan

`waitingOn` from the index, ordered by who is blocked:

| `waitingOn` | Means | Report as |
|---|---|---|
| `me:ci-red` | ≥1 failing check | **You** — fix or rerun the flake |
| `me:changes-requested` | Reviewer requested changes | **You** — address and reply in-thread |
| `me:needs-rebase` | `mergeStateStatus` DIRTY/BEHIND | **You** — restack |
| `me:draft` | PR open but draft | **You** — publish or keep stacking |
| `me:ready-to-merge` | Approved, mergeable | **You** — queue it |
| `me:no-open-pr` | Plan in `open/` with no tracked PR | **You** — link the PR or demote to `next/` |
| `me:refine` / `me:start-execution` / `me:file-it` | Folder-derived | **You** — the folder's own next step |
| `ci` | Checks pending | Waiting on CI |
| `reviewers` | Submitted, no decision yet | Waiting on reviewers |
| `user:closed-unmerged` | PR closed without merging | **Decision needed** — done or discarded? |

## 3. Report

Lead with the answer — the count of plans needing you and the single most urgent
one. Then:

**Needs you now** — per plan: title, folder, reason, and the PR link for the
blocking PR. Include `next_action` from frontmatter when present; it is the
plan's own statement of what comes next.

**Waiting on others** — grouped by reviewers vs CI, one line each, with how long
(`updatedAt` age in days). Call out anything waiting on reviewers >2 days.

**Queued** — `next/` plans ready to execute, newest first.

**Drifted** — plans whose `move` is set: the folder disagrees with PR reality
(e.g. still in `open/` but every PR landed). End with: run `/plan-sync` to file
these.

**Unfiled** — count of root-level plans with a one-line nudge, not a list, unless
the count is under five.

Keep it scannable: a table or tight bullets, no prose paragraphs per plan. Note
draft PRs explicitly — a draft is not waiting on reviewers.

## Fast variants

- "what's red" → filter to `me:ci-red`, then per PR: failing check names via
  `gh pr checks <n> --repo <repo>`.
- "what changed since yesterday" → sort PRs by `updatedAt` and report only those
  newer than the plan's frontmatter `updated`.
- "standup" → three bullets: landed since last check (from `done/` moves pending
  in the index), in flight, blocked.
