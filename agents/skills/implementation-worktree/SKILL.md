---
name: implementation-worktree
description: REQUIRED before every implementation or code-editing task. Vinny requires a new dedicated git worktree and Graphite-managed stacks; never implement in ~/code/clay-base. Applies to features, fixes, refactors, and implementation subagents.
---

# Implementation worktrees and Graphite

- Never implement or edit project files in `~/code/clay-base`. Treat the primary checkout as read-only for implementation; do not switch its branch to start work.
- Before any implementation edit, create a new dedicated worktree for the task. For clay-base, use `~/code/worktrees/clay-base/<topic>/clay-base`. Continue an existing task only in that task's dedicated worktree.
- Use Graphite stacks for implementation branches: verify `gt auth`, create branches with `gt create` or track an existing branch with `gt track --parent <parent>`, and use Graphite for commits, restacking, and authorized PR submission. A single logical change may be a one-branch stack; do not invent unnecessary layers.
- Set every command's cwd and every file/tool path to the dedicated worktree. Give subagents its exact path and prohibit edits to the primary checkout. Do not rely on the session's initial cwd.
- Run `bash infrastructure/scripts/setup-worktree.sh` in a new clay-base worktree. All worktrees share Docker services and local databases; do not start a second dependency stack or run unrelated migrations.
- Do not commit, push, or open a PR merely to satisfy stack tracking; do those when authorized by the task.
- If Graphite or worktree creation is unavailable, report the blocker; do not silently fall back to implementing in the primary checkout.
