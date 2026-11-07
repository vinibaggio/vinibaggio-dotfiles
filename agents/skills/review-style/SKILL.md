---
name: review-style
description: Vinny's preferred voice, structure, and priorities for code review comments (PR reviews, inline comments, review writeups). USE THIS whenever writing or posting a code review, a review comment, or a review summary on his behalf, or when he says "review this PR", "help me review", or "comment these". Prose rules here extend `pr-writing-style`, which owns PR descriptions.
---

# Review style

How Vinny reviews code, distilled from his hand-written comments across ~250 reviews in clay-base. Apply this to review comments; `pr-writing-style` owns PR descriptions and change writeups.

Overall voice and register come from `technical-writing-voice`. This skill covers review-specific mechanics. Every code review also loads `software-design` and applies its smell/move/check bar; do not wait to be asked. When the diff touches migrations, schemas, SQL/ORM queries, ClickHouse, or Redis/Valkey/BullMQ, it also loads `database-design` and checks each finding against the production engine version. Addressing bot findings on Vinny's own PRs is `address-bot-reviews`.

## Orient the reviewer first (chat only)

Every review handed back to Vinny opens with a short "what this PR does" blurb, before any findings or draft comments. PR descriptions tend to list the changes at file and symbol level, which tells him what moved but not why it matters. The blurb fills that gap:

- The problem in user or system terms: what broke or was missing, and who or what hit it.
- The mechanism of the fix in plain language: what now happens, when, and what triggers it.
- How it fits the surrounding system: which existing flows it hooks into or relies on, and what it deliberately does not touch.
- How it ships: the flag, the default, and what changes on deploy.

Keep it to one short paragraph or 3 to 5 bullets, and build it from the code you read, not by paraphrasing the description. Where the description and the code disagree, say so. The blurb is for Vinny only: it never goes into a posted comment, and "say less" below still governs what does.

## Default: say less

Most of his reviews are a bare approval. Prose is for something real. If the diff is fine, approve and say so in a few words. Do not manufacture findings to justify a long comment, and do not restate what you checked and found correct at length.

## Voice

- Short, lowercase, conversational. "lgtm post comments", "thank you!", "o_O this was hard to parse".
- Ask instead of asserting when the answer depends on intent: "shouldn't we lock before we update the step above?", "does Prisma.sql handle SQL injection?". End genuinely open items with "what do you think?".
- Never write "reason being". Put the reasoning in its own sentence right after the question.
- Be honest about provenance and uncertainty. "i ran this through claude reviews and i think i agree" and "i have no idea how this race could be implemented" are both fine and preferred over laundered confidence.
- Give credit and warmth where earned ("thank you!", "EXCITING!"). Humour is welcome.
- Bound the approval to what you actually reviewed. Never write "approve on the workflows side": workflows authors (Mihika included) are on the same team, so the phrase reads wrong. A plain "lgtm" is the default approval body.

## Simplified Technical English (always)

Write every posted review comment in Simplified Technical English (ASD-STE100). This applies to inline comments, review summaries, and replies. Keep the lowercase voice and the question-first shape above; STE governs the words and the sentences.

- One topic per sentence. Descriptive sentences at most 25 words, instructions at most 20.
- Simple tenses only (present, past, future). Active voice. Use articles ("the", "a").
- Use approved, literal words with one meaning each. No idioms, slang, or phrasal verbs ("bails", "knock", "sits", "walks", "hits", "falls through", "pick up"). Say "stops", "seal call", "stays", "reads", "goes to", "selects".
- No "-ing" words as nouns or modifiers, except technical names and code states (`ingesting`).
- Technical names, code symbols, and states are allowed as-is; put symbols in backticks.
- Use numbered steps for a sequence of events (a race, a crash path) and bullets for parallel facts.
- Ask for action with "can you ...?" or "please ..."; ask for an opinion with "do you agree?". Use "i recommend" for a preference.

## Bias toward unblocking

- Prefer a conditional approval over a block: "approved pending resolving the bot review comments", "approved with one follow-up concern about X".
- Mark blocking vs non-blocking out loud. "Non-blocking", "neither needs to gate the merge".
- Accept "fix it here or scope it out in the description" as a valid resolution; ask for the follow-up to be named, not necessarily done.
- Close the loop on re-review: say what you re-read and what is now addressed.

## Structure for a substantial review

1. One line on what you actually read, including the surrounding code the diff depends on. Do not claim more than you read.
2. "Verified as sound" first: the load-bearing things you checked that are genuinely correct, especially rollout order, authz, and the bug the PR claims to fix.
3. Findings ordered by how likely they are to bite, each with the file and the specific line or symbol that proves it, and a concrete ask ("please derive the chunk size from the target config, and add a cross-mode chaining test").
4. Severity as P levels (P1 blocking-ish, P2 worth addressing, P3 minor), not high/medium/low headings.
5. Non-blocking nits last, capped at a handful.
6. Questions for the author at the end.

## What to hunt for, in rough priority order

1. Races and lock ordering. Lock before the write. Retried callbacks both winning. Queue job names are not dedup IDs. Re-read under `FOR UPDATE`. Heartbeats overlapping a release. Expensive work done by the side that loses the race.
2. Safety caps and limits bypassed by a new code path (a new route inheriting the wrong cap, fan-out that multiplies steps).
3. Rollout and deploy order: additive contract fields, flag gating, whether one side can ship first. Also argue the other direction: versioning machinery is redundant when a default-off flag already closes the window.
4. Query cost on hot paths: a new orderBy with no index behind a poll, an expensive query hoisted above a compare-and-set, per-request calls added to something that now runs every few seconds.
5. Failure modes that strand the user: unbounded retry loops, state that can never leave "busy", errors treated as "still running".
6. Silent data loss and asymmetric normalization: transforms that drop fields, fingerprints that are key-order sensitive feeding comparisons that are not.
7. Analytics and observability, priced: ask for named events with the exact properties, but only when it does not add real work or a new network call.
8. Test quality over count: wall-clock assertions that can flake, untested null transitions, suites where both sides come from the same factory so they cannot catch the asymmetry. Name the test to add.
9. Security spot checks kept cheap: ask the direct question, verify, and move on.
10. Scope discipline: one logical change, follow-ups named.

## Formatting

- No em dashes. Use commas, colons, or parentheses.
- Ration backticks. Use them for symbols that carry the argument, not for every identifier. Never wrap natural-language quotes in backticks.
- Ration bold. Do not bold every finding title and every noun.
- Plain naming: "the session service", "the deploy bot", over exact symbol or job names when the plain phrase is clearer.
- Present tense for behavior that still exists on the branch.
- No invented compound nouns: "crashes due to the order hooks are invoked", not "hook-order crashes".
- Avoid AI tropes: inflation, fabricated confidence, exhaustive enumeration of every file touched.

## Provenance

When an agent produces the review, keep his convention of marking it, e.g. a `## Review [AI]` heading, and say plainly what was and was not verified.


## Cutting a review down to what he will actually post

Worked example, PR 54832 in clay-base (bulk node rerun: deterministic run ids, snapshot pinning, stranded-step recovery). A full pass produced two P2s, four simplifications, and a nit. He posted one finding, as a question, and approved. How he got there:

- Do the wide pass privately, post the narrow one. Investigate everything, then pick the single finding worth the author’s attention and keep the rest out of band (mention them in chat, or offer to add them, rather than posting a list).
- Prefer the finding that questions whether the machinery should exist over the findings that harden it. He dropped a correctness race and three dead-weight cleanups to keep the one asking whether a custom queue job id earns its keep.
- No restating the change. The comment opens on the finding. No summary of what the PR does, no verified-as-sound preamble when the review is one point.
- Phrase every finding as a question, even when you have verified the answer, and follow it with the reasoning in the next breath.
  - P2: ask whether the thing holds. "does this dedupe anything? it cannot collide with ..." not "this does not dedupe anything".
  - P1: ask whether you have read it right, in do-I-understand-this-correctly shape. "do I understand this correctly: if the worker dies after the commit, the run stays running with no queue job?" The author gets to correct the reading before defending the code, and you are not asserting a break you cannot reproduce.
- Propose the lazy resolution in his words: "maybe just drop it?", followed by why removing it is cheap (what the existing guard already covers, and the parameter, the plumbing, and the caller obligation that go away with it). Name the other direction, then say which way you lean.
- Do not approve reflexively. Approving alongside a finding is fine when it is genuinely non-blocking, and on 54832 it was, but a P1 asked as a question should usually be a comment, not an approval, until the author answers. Say which it is out loud ("non-blocking either way", or leave it open pending the answer).
- Skip anything a bot already posted or the author already declined. On that PR the bots had filed nine comments and the author had answered each one; the posted finding was about whether the accepted fix was worth keeping, which is new ground rather than a re-assert.
- Ask before posting, and iterate on the wording. He rewrote the same comment three times (assertion to question, then to "maybe just drop it?") before it went up.
- Say what you left out after posting, so he can add it deliberately.
- Explain your reasoning to the operator, not in the PR. Chat gets the plain-language version: what you checked, why the finding matters, what you deliberately left out. The posted comment stays short and stays a question. Never move the explanation into the PR comment or the PR description to justify the finding.
