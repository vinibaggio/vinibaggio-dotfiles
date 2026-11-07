---
name: ship
description: Run local checks, commit, and submit a stacked Graphite PR, then drive CI to green. Use when the user says "ship this", "ship it", or asks to take finished work all the way to an open PR with passing checks.
user_invocable: true
---

# Ship

Take work that is already implemented and drive it to an open PR with green CI. This is a pipeline, not a rewrite — do not add features or refactor while shipping.

If the work is not actually finished, say so and stop. Shipping is not a way to finish implementing.

## Compose, don't duplicate

This skill sequences other skills. Invoke them; don't reimplement their contents.

| Step | Skill to invoke |
|------|-----------------|
| Branch naming, PR title, PR body structure | `create-pr` |
| Wording of the summary and test plan | `pr-writing-style` |
| Any `gt` command semantics | `graphite` |
| Screenshots or Loom in the PR body | `pr-assets` |
| CI failure triage and flake reruns | `fix-pr-checks` |
| Independent code review and design review before every push | `pre-push-review` |

## Step 1 — Scope the change

```bash
git status --short
git diff --stat
```

Derive the affected workspaces from the changed paths. Every check below is scoped with `--filter` to those workspaces only. Never run unscoped `turbo` here.

**Stop and report if `libs/shared-backend/public-actions` shows as modified.** Hooks drift that submodule pointer as a side effect. Restore it to HEAD and never stage it:

```bash
git checkout -- libs/shared-backend/public-actions
```

## Step 2 — Local gate (before any commit)

Run all four, scoped. Fix real failures and re-run until clean.

```bash
turbo tsc        --filter=./path/to/pkg   # use ..../path for changed libs
turbo lint       --filter=./path/to/pkg
turbo format:check --filter=./path/to/pkg
turbo test       --filter=./path/to/pkg
```

Run tests in the foreground. Do not background them and report success from a partial log.

Do not proceed to commit while anything above is red. If a failure is pre-existing on `dev`, prove it by checking the same command on `dev` before dismissing it.

## Step 3 — Commit and submit

Use `gt create`, then run `pre-push-review` on the new commit, then `gt submit`, per the `graphite` skill. Conventional Commits title with scope, per `create-pr`. Do not submit while a P1 or P2 is open.

**Rename the branch.** `gt` auto-generates a branch name from the commit message; always replace it with `vinibaggio/<slug>-<N>-<tag>` where `<N>` is the position in the stack. Do this before submitting.

Mark AI-written text: put `[AI]` in the headings of the commit body and PR description.

## Step 4 — CI to green

```bash
gh pr checks --watch
```

Classify every failure before acting, and state the evidence for the classification:

- **Flake** — timeouts, known-flaky suites (Eppo), infra 5xx. Rerun, at most twice.
- **Real** — fix it, then re-run Step 2 and `pre-push-review` before pushing again.

Retry GitHub API 5xx with backoff rather than reporting failure; these outages have lasted 45 minutes.

## Step 5 — Review comments

Fetch review comments from Codex, the Claude bot, and humans. Address each one, run `pre-push-review` on the fix commits, push, then reply **in-thread** on that specific comment with what changed, where it changed, the commit hash when available, and the relevant validation. If a finding is not addressed, reply with the reason. For feedback posted as a general PR comment, leave a concise follow-up PR comment covering each finding. Verify the replies are visible before reporting completion. A blanket "addressed all feedback" comment does not count.

## Hard rules

- Never `git push --force`.
- Never bypass a pre-push hook. If one fails on pre-existing repo breakage, root-cause it and ask before using `--no-verify`.
- Never push while `pre-push-review` has an open P1 or P2.
- Never stage files outside the change's scope.
- Report the actual state at the end: PR number/URL, and which checks are green versus still running.
