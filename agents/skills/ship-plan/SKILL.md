---
name: ship-plan
description: Drive every task in a plan document to a merged-ready stacked PR autonomously — implementer/reviewer subagent loop, local gate, Graphite submit, CI to green, bot review replies. Use when the user gives a plan document path and asks to ship it, execute it, or drive it to PRs.
user_invocable: true
---

# Ship a plan

Input: a path to a plan document — normally `~/code/ai-docs/next/YYYY-MM-DD-<slug>.md`. Output: one merged-ready stacked PR per task, CI green, bot comments answered.

You supervise at the plan boundary. The user supervises at the plan boundary too — do not return to them for CI retries, flake reruns, GitHub outages, or reviewer nits. Return to them only for the escalations listed at the bottom.

## Compose, don't duplicate

| Concern | Skill that owns it |
|---------|--------------------|
| Plan folder lifecycle, plan frontmatter, `prs` tracking | `plans` |
| Per-task local gate, branch rename, submit, CI classification | `ship` |
| Independent code review and design review before every push | `pre-push-review` |
| Branch/PR naming, PR body structure | `create-pr` |
| Summary and test-plan wording | `pr-writing-style` |
| `gt` command semantics, restacking | `graphite` |
| CI log fetching, flake detection, rerun | `fix-pr-checks` |
| Frontend task standards | `clay-frontend` (mandatory before any `apps/frontend/` edit) |

`ship` is the per-task engine. This skill is the loop around it.

---

## Phase 0 — Preflight (do all of this before task 1)

Preflight failures are cheap. Discovering them at task 3 is not.

1. **Read the plan document fully.** Extract, per task: declared file scope (create/modify/test), interfaces, and acceptance criteria. If the plan has no task decomposition — it's a design spec, not a plan — stop and say so. Offer to convert it to a plan first.

   The plan lives in the ai-docs lifecycle (`plans` skill). A plan in `drafts/` is not shippable — it goes back for refinement. When the plan is executable, move it to `open/` before task 1 and record each PR as you open it:

   ```bash
   node ~/.agents/skills/plans/scripts/plan-move.mjs <plan-path> open --waiting-on me --next-action "task 1 in flight"
   node ~/.agents/skills/plans/scripts/plan-move.mjs <plan-path> open --pr clay-run/clay-base#<N>   # after each 1d
   ```

2. **Verify the base branch.** Plans routinely say "this stacks on PR #N". Check whether those prerequisites are actually present in the working tree:

   ```bash
   git branch --show-current
   gh pr view <N> --json number,state,headRefName,baseRefName
   ```

   Then confirm the primitives the plan says already exist are on disk. If the plan says "do not rebuild X" and `X` is missing, **you are on the wrong base** — do not let an implementer rebuild it. Check out the prerequisite head branch and stack from there.

   State the resolved base branch before starting. If prerequisites are open PRs, note that the stack will need restacking when they merge.

3. **Verify test conventions per workspace.** For each workspace the plan touches, read an **actual sibling test file** — never infer. Capture: runner (Vitest vs Jest — this repo uses both), factory/fixture helpers, mock style, `__tests__/` layout vs co-located. Record these verbatim; they go into every implementer prompt.

4. **Confirm the clean-tree invariant.**

   ```bash
   git status --short
   ```

   `libs/shared-backend/public-actions` must never appear staged. Hooks drift its pointer as a side effect; restore it to HEAD and never stage it.

---

## Phase 1 — Per-task loop

For each task in plan order. Do not start task N+1 until task N's PR is open and its local gate passed.

### 1a. Implement

Dispatch **one implementer subagent** with:

- The task's verbatim spec from the plan, including declared file scope and interfaces.
- The verified test conventions from Phase 0.3 — the actual sibling test path, runner, and factory names. Instruct: *do not guess factories or file layout; open the named sibling test first.*
- The global constraints section of the plan (these are usually load-bearing — e.g. compose predicates from a shared module rather than inlining).
- An explicit boundary: **touch only the files this task declares.** Anything else is a finding to report back, not to fix.

### 1b. Local gate (before any commit)

Scoped to the task's workspaces. All four must pass. Tests in the **foreground** — never backgrounded, never a success claim from a partial log.

```bash
turbo tsc          --filter=./path/to/pkg    # ..../path when changing a lib
turbo lint         --filter=./path/to/pkg
turbo format:check --filter=./path/to/pkg
turbo test         --filter=./path/to/pkg
```

Red gate ⇒ no commit, no push. If a failure looks pre-existing, prove it by running the same command on the base branch before dismissing it.

### 1c. Review

`gt create` the task's commit, then run `pre-push-review` on it. The implementer never reviews itself. Pass this checklist to review A as task lenses, all of it, every round:

- **Data loss / round-trip fidelity** — does a value survive save→load→save unchanged? Dropped fields, lossy normalization, overwritten defaults. This class has bitten this pipeline before.
- **Event propagation** — `stopPropagation` / `preventDefault` correctness; nested interactive targets (a checkbox inside a clickable row must not fire the row handler); keyboard activation and focus order.
- **Edge cases at 0 and sub-1** — zero-cost, empty collections, sub-1 values that round to 0, null vs absent, off-by-one at boundaries.
- **Scope drift** — any file touched outside the task's declared scope.
- **Plan conformance** — does it satisfy the task's stated interfaces and global constraints?

Hand each open P1 and P2 to the implementer subagent, then rerun 1b and the review on the fix commits. The 3-round cap in `pre-push-review` applies: an open P1 or P2 after round 3 is a design disagreement, not an implementation defect, so escalate with both positions.

### 1d. Submit

Per `ship` and `graphite`: rename the branch to `vinibaggio/<slug>-<N>-<tag>` (`gt`'s auto-generated name is never acceptable), then `gt submit`. `[AI]` in commit-body and PR-description headings.

### 1e. CI to green

```bash
gh pr checks --watch
```

Classify **every** failure and report the classification with its evidence:

- **FLAKE** — timeout, known-flaky suite (Eppo), infra 5xx, passes on retry. Rerun, **max 2x**. If it fails a 3rd time, reclassify as REAL.
- **REAL** — fix, re-run 1b and `pre-push-review`, then push.

Never report a failure as flake without evidence. "It's probably flaky" is not evidence; a timeout in the log or a known-flaky-suite match is.

### 1f. Bot review comments

Fetch review comments from Codex and the Claude bot:

```bash
gh pr view <N> --json reviews,comments
gh api repos/{owner}/{repo}/pulls/<N>/comments
```

Fix each, run `pre-push-review` on the fix commits, push, then reply **in-thread on that comment**. A single summary comment does not count. If you disagree with a bot, say so in-thread with reasoning rather than silently ignoring it.

---

## Transient-error handling (never surface these)

Retry with exponential backoff for **up to 10 minutes** before reporting:

- **GitHub 5xx** on any `gh` call — these outages have lasted 45 minutes; keep retrying inside the window.
- **GraphQL body rejection** on PR create/edit — retry once with a **plain-text fallback body** (strip markdown tables, HTML, embedded images), then attach the rich body via `gh pr edit` once accepted.

Log each retry so the transcript shows the wait was real. After 10 minutes, report the failure with the last response body.

---

## Hard rules

- Never `git push --force`.
- Never push while `pre-push-review` has an open P1 or P2.
- Never stage changes outside the current task's declared file scope.
- Never stage `libs/shared-backend/public-actions`.
- **Pre-push hook failure: root-cause it and tell the user before working around it.** Do not reach for `--no-verify` autonomously. (Known live example: `libs/glaze` missing its `tsgo` devDependency breaks the pre-push tsc sweep for any PR touching `libs/shared` — pre-existing and unrelated to the change.)

## Escalate to the user (and only these)

1. A task's **design intent is genuinely ambiguous** — two readings produce materially different implementations.
2. Reviewer and implementer deadlock after 3 rounds.
3. A pre-push hook fails.
4. Preflight finds the plan's prerequisites missing and the correct base is not determinable.
5. The plan has no task decomposition.

Everything else — flakes, outages, lint failures, reviewer nits, rebases — you handle.

## Final report

Per task: PR number and URL, CI state, review-comment count answered, and any deviation from the plan with its justification. Then the stack shape (`gt log short --no-interactive`) and anything left open.

Then leave the plan's own state correct: it stays in `open/` with every PR in `prs` and a `next_action` naming what the stack is waiting on (review, queue, follow-up task). `/plan-sync` moves it to `done/` once the PRs land — do not pre-move it.
