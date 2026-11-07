---
name: secreview
description: Budgeted security review of the current diff only, emitting findings incrementally. Use when the user asks for a security review, a security pass, or "check this for vulnerabilities" on work in progress or a branch.
user_invocable: true
allowed-tools: Bash, Read, Grep, Glob
---

# Security review (diff-scoped)

Review the diff. Not the codebase.

The failure mode this skill exists to prevent: reading and grepping for many turns and producing no findings. **Output must start arriving within ~10 tool calls.** If the budget runs out, report what you have and name what you did not reach — a partial report is the deliverable, not a reason to keep going.

## Step 1 — Get the diff (always first)

```bash
git diff --stat $(git merge-base HEAD origin/dev)...HEAD
git diff $(git merge-base HEAD origin/dev)...HEAD
```

For uncommitted work, use `git diff HEAD` instead. If the diff is empty, say so and stop.

Read the hunks from this output. Do not open the full files unless a specific hunk raises a question you cannot answer from the diff — and when you do, say why in the report.

## Step 2 — Review each hunk against these lenses

- **Authz / tenant isolation** — is the workspace or user scope checked on every new query and endpoint? A missing `workspaceId` predicate is the highest-value bug class in this repo.
- **Data exposure** — PII or secrets in logs, error messages, telemetry, or API responses that were not there before. Missing redaction.
- **Injection & untrusted input** — raw SQL or Vitess query construction, template interpolation, and untrusted input flowing into AI/workflow nodes as prompt content.
- **Secrets & config** — committed credentials, new env vars without safe defaults, security loosened outside a `NODE_ENV === 'development'` guard.

## Step 3 — Emit findings incrementally

Print each finding as you confirm it. Do not accumulate silently and dump at the end.

| file:line | severity | issue | suggested fix |
|-----------|----------|-------|---------------|

Severity is `high` / `med` / `low`. Rank high first.

Rules for the report:

- A finding needs a concrete failure path: what input or actor, reaching what, with what consequence. "Could be unsafe" is not a finding.
- If you suspect something but could not confirm it within budget, list it as **UNVERIFIED** with the one check that would settle it. Never present a guess as confirmed.
- If there are no findings, say exactly that. Do not pad with style notes or generic hardening advice.

## Step 4 — Close out

End with: hunks reviewed, files you opened beyond the diff (and why), and anything skipped.
