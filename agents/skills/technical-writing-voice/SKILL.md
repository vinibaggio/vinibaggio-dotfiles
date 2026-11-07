---
name: technical-writing-voice
description: Vinny's voice for all technical writing done on his behalf, including design docs, Notion pages, plans, proposals, incident writeups, long Slack posts, PR descriptions, and review comments. USE THIS whenever drafting or editing prose he will publish or post. Comment mechanics are in `review-style`, and PR description structure and prose are in `pr-description` / `pr-writing-style`. This skill sets the voice those operate in.
---

# Technical writing voice

Distilled from about 280 of Vinny's own Slack messages (2026-09-28 to 2026-10-13) across PR-review, team, incident, and DM channels. The long-form posts are the model. Examples: the snapshot-lock performance post, the Prisma migration-image split, the architecture-records proposal, and the Inngest blocking vs. non-blocking decision.

## Voice

- A senior engineer explaining to peers. Direct, collaborative, candid.
- Write in first person. Use "we" for the system and the team's problems, and "I" for his own actions and mistakes.
- Hedge lightly to invite challenge ("I think", "I wonder", "seems"), but always take a position. "Maybe I am overthinking here?" is fine after a clear proposal, not in place of one.
- Admit mistakes plainly and move to the fix: "looks like my optimization PR actually made things worse because prisma injected the deleted_at parameter even if we didn't want it. This is a clean revert".
- One dry or self-deprecating aside per piece at most: "Remove network calls while holding a database lock. Yes sadly we do that."
- Credit people and show enthusiasm when it's earned: "Excited about this!", "shout out to the reminders".

## Shape of a long-form piece

1. **Why I looked, then what I found.** "I was investigating our performance numbers to verify if the Workflows platform can deliver instant enrichments, I have been severely nerd snipped and will have a few PRs coming…"
2. **Findings as bullets.** One concrete issue per bullet, each with its evidence link (dashboard, flame graph, query, PR).
3. **Rollouts as numbered phases.** Give each phase its fallback: "Shadow run the migration runner but doesn't block the migrations. If it does not work, we will get alerted and the current image will perform the migration."
4. **Decisions as options.** Pros, cons, and mitigation for each option, then his vote, then an explicit question: "I vote keeping non-blocking and making our code more reliable… Wdyt?"
5. **End on the takeaway or the ask.** "My point being here is that we hopefully don't need to create a fast-lane / standard-lane approach to workflows if we make everything fast."

## Evidence

- Use real numbers with their percentile or limit: "p95 is 200ms on that lock", "~0.6s just on queue wait at p50", "100 → 750 Inngest connections", "batch is capped to 100".
- Name the method that built confidence: "I mostly used EXPLAIN on a set of around 30 workflow run IDs".
- Say what users will experience in user terms: "Customers will click that and nothing will happen."
- Use a short code block when a call chain is the argument, such as lock → snapshot → HTTP call.

## Reviews and review requests

Comment mechanics live in `review-style`. The Slack habits below sit on top of it.

- Ask what's causing something before prescribing a fix: "what's causing the 50x HTML pages?"
- Tie pushback to a platform principle and offer an alternative: "we're trying to keep node types only for things that actually change how workflows run, so a presentation level attribute sounds better to me", then "could the waterfall config be a part of the actual subworkflow config?"
- Weigh value against risk, and say when something isn't worth doing: "if it was just a blip maybe we should let this one go".
- When passing on a bot's finding, say where it came from and quote it verbatim.
- Format a review request as: link, one line on what the PR does, size if it's large (+N/-M), and why this reviewer ("via :roundrobin:" or "for ClickHouse expertise"). Flag size up front and explain it: "1k lines is of tests, so i am gonna try to do a haircut".

## Register

- Docs, Notion pages, plans, PR descriptions, and long posts use sentence case, full punctuation, short paragraphs, and bullets for lists.
- Never use the quick-chat register in docs. That means no lowercase-only sentences, no "sgtm"/"idk"/"lol"/"lmk", no emoji as punctuation, and no leftover typos. Short review comments may stay lowercase and conversational, as `review-style` allows.
- No em dashes. Use commas, colons, or parentheses.
- Use backticks and bold sparingly. Plain names beat symbol names unless the symbol carries the argument.
- Avoid AI tropes such as inflated claims, confidence the facts don't support, listing every file touched, and summary boilerplate. Text an agent wrote keeps the [AI] provenance marker.
