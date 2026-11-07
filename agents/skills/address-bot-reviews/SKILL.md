---
name: address-bot-reviews
description: USE THIS whenever Vinny says "address bot reviews", "address codex reviews", "address automated reviews", "address reviews on <PR> and above", or pastes a bot finding from one of his own PRs. Defines which bots count, how to triage each finding, and how to reply and report. Reviewing other people's PRs is `review-style`.
---

# Addressing bot reviews on Vinny's PRs

"Bot reviews" always means every source below, on every PR in scope. Do not wait to be reminded about one of them.

## Scope

- "on 65079": that PR only.
- "on 65079 and above" / "up the stack": that PR and every open PR above it in the Graphite stack (`gt log --stack`).
- Re-resolve each PR head before reading findings and again before replying. Findings on a superseded commit can already be fixed or moved.

## Sources

| Source | Login | Where the findings are |
|---|---|---|
| Codex | `chatgpt-codex-connector[bot]` | Inline review threads with P1/P2/P3 badges. `gh api repos/clay-run/clay-base/pulls/<N>/comments` |
| Claude | `claude[bot]` | One issue comment, "Code Review: …", findings in the body. `gh api repos/clay-run/clay-base/issues/<N>/comments` |
| Risk check | `github-actions[bot]` | Issue comment headed "🟢 Safe to Merge" / "🟡 Human Review Recommended" / red; concerns in the body |
| Softlight | `softlight[bot]` | "Softlight Overview" issue comment plus any inline P1/P2 UX findings and recorded videos |

Ignore `github-actions[bot]` deploy and merge-queue notices here; a merge-queue eviction is a CI task, not a review finding. Bots run on non-draft PRs or drafts with the `enable-bot-reviews` label; if a source is missing, say so instead of treating silence as approval.

## Triage every finding

Verify each claim against the code at the current head, and against production data when it is about behavior or scale (read-only Datadog/ClickHouse is pre-approved). Bot severity is a hint, not a verdict. Then pick one:

1. **Fix.** Make the change, add or adjust a test that fails without the fix, and confirm it fails when the fix is reverted.
2. **Decline.** The finding is wrong, already handled, or intended. Give the concrete reason (file, guard, data).
3. **Ask Vinny.** The answer is a product or scope call (e.g. "is cross-incident rate limiting intended?"). Do not guess.

Do not split a fix into a separate PR if that leaves this PR broken on its own.

Before pushing fixes, run `pre-push-review` on the fix commits. Its P1s and P2s block the push like any bot finding.

## Reply

- Codex inline threads: reply in the thread, then resolve threads you fixed (`gh api graphql` with `resolveReviewThread`). Leave declined threads open with the reason unless Vinny says otherwise.
- Claude, risk check, Softlight: one reply comment per PR that answers each item by number.
- Wording follows `review-style` (Simplified Technical English). Mark replies `[AI]`.

## Report back

One table per run: PR, source, finding (short), action (fixed / declined / needs Vinny), and the test or evidence. List anything still waiting on Vinny at the end.
