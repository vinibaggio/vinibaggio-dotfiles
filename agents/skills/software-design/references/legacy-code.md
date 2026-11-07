# Legacy code: from undesigned to designed without a rewrite

Sources: Working Effectively with Legacy Code (Feathers) and Patterns of Legacy Displacement (Cartwright, Horn, Lewis on martinfowler.com). Feathers' definition is the working one: legacy code is code without tests, whatever its age. Most of the hot path in this repo qualifies; it has integration tests at the edges and nothing that pins the behavior of a 2,000-line function's middle.

The two failure modes this file prevents: **edit and pray** (grow the monster by 80 lines because that is where the code is) and **rewrite** (a new module nobody switches to because the old one keeps absorbing changes). The path between them is seams, sprouts, characterization, and a ratchet.

## 1. The change algorithm

Feathers' five steps, as the order of operations for any change to untested code:

1. **Identify change points.** Where does the behavior have to differ? Name the function and the branch.
2. **Find test points.** Where can you observe the effect? For a step executor that is the result union it returns and the rows it writes; for a React component it is the rendered output for a fixed props set.
3. **Break dependencies** so the test point is reachable without the world (database, Redis, HTTP). In TypeScript the cheap seams are below.
4. **Write characterization tests**: tests that assert what the code does today, not what it should do. Run the code, capture the output, assert it. They are a net, not a spec.
5. **Make the change and refactor** under the net. Then decide which characterization tests describe intended behavior (keep) and which pinned an accident (delete, in the PR that changes the accident).

## 2. Seams in TypeScript

A seam is a place where behavior can be changed without editing the code at that place. Three kinds exist here, cheapest first:

| Seam           | How                                                                                                     | Use for                                                             | Cost                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Parameter seam | The function takes the collaborator (`load`, `now`, `publish`) as an argument with a production default | Making a shell function testable; injecting a clock or a repository | None at call sites if defaulted; the signature says what it depends on |
| Module seam    | `vi.mock('../client/clay-api.client')` or an injected module object                                     | Cutting off an outbound client wholesale in a unit test             | Tests know the import path; brittle under moves                        |
| Table seam     | Behavior looked up from an exhaustive registry; the test swaps one entry                                | Testing dispatch and one kind at a time                             | Requires the registry to exist (see `patterns.md`)                     |

What is not a seam: a feature flag read inside the function (that is a second production path, not a test point), and a global singleton reassigned by the test (works until two tests run in parallel; the integration harness runs workers in parallel).

## 3. Sprout, don't grow

When a change lands inside a function you cannot test, do not add the lines there.

- **Sprout function**: write the new behavior as a new, pure or shell function with its own tests; call it from one line in the old function. The old function gets one line longer and no new branches.
- **Sprout module**: when the new behavior has its own data or several functions, a new file (`<kind>-node-execution.service.ts`, `<concern>.repository.ts`) and one call site.
- **Wrap function**: when the change is "before/after" (log, measure, validate, publish), rename the old function, create a new one with the old name that calls the old plus the addition. The old body is untouched.

The check: the diff of the monster file is a few lines. If the diff of a 2,000-line file is 80 lines, the change was grown, not sprouted. Reviewers can ask for the sprout.

## 4. Breaking the monster function

The order of extraction matters; most attempts fail because they start with the hard part.

1. **Sense first.** Add a test that drives the function end to end for one input and asserts the result union and the writes (the integration harness, the in-memory queues). You now have a characterization test for one path.
2. **Extract the pure parts first.** Input resolution, config defaults, decision logic that reads locals and returns a value. Extract Function on each; the locals become parameters. These are safe and testable in isolation.
3. **Introduce a parameter object** for the locals every branch reads (`StepContext`: step, run, snapshot, resolved inputs). The branches now take one argument. This is Introduce Parameter Object and it is what makes step 4 possible.
4. **Extract one branch per kind** into its own function taking the context and returning the result union. Leave the dispatch (`if (type === 'code') return executeCode(ctx)`) in place. Each extraction is one PR with the characterization test green.
5. **Replace the dispatch with a lookup** only when every branch is extracted. Until then the doc says what the fall-through does.
6. **Shared epilogue** (usage merge, error wrapping, outputs persistence) becomes a wrapper around the lookup, not a copy in each branch.

Lean on the compiler at every step: change a type, follow the red squiggles. Narrowing `nodeType: string` to the union and fixing the errors is a complete, mechanical refactoring the compiler verifies. Preserve signatures while moving code; change signatures in a separate step.

## 5. Characterization tests and what to do with them

- Capture, do not design: run the existing code with a fixed input and assert whatever it produced, including the odd parts. Name the test after the input, not the behavior ("conditional step with two rules and no match").
- Count the writes. On a hot path the characterization includes how many statements and queue ops the scenario issues; that is the budget the refactoring must not grow.
- Delete pinned accidents in the PR that fixes them. A characterization test is not a contract; re-pinning a wording or an incidental default after you have changed it on purpose is the thing to avoid.
- Prefer the integration harness for shell code and plain unit tests for sprouted pure code. A mocked unit test of a shell function pins the mocks, not the behavior.

## 6. Displacement patterns for modules and surfaces

Patterns of Legacy Displacement, chosen for an in-repo module rather than a system:

- **Strangler fig**: the new module takes over call sites one at a time; the old one shrinks until deletion. The ratchet baseline is the strangler's progress bar: every PR either leaves it or shrinks it. Precedents: run creation moved behind one persistence module; Postgres access moving behind repositories one aggregate per PR.
- **Transitional architecture**: scaffolding you build knowing you will remove it (an adapter from the old shape to the new, a dual-write). Name the removal condition in the PR; a transitional piece with no removal condition is the new legacy.
- **Divert the flow**: route new callers to the new module first (lint forbids new imports of the old one), then migrate old callers. The lint exemption list is the old callers; it only shrinks.
- **Event interception**: capture the events the old path emits and feed the new path (or the read model) before switching writers. CDC into ClickHouse is this pattern.
- **Feature parity is a trap**: a rewrite that must match every behavior of the old module ships late and copies the accidents. Displace by capability, with the characterization tests you chose to keep as the definition of "done".
- **Canary and dark launch**: a release toggle per workspace, with the old path as fallback, is how a changed hot path ships. The flag's death is part of the plan.

## 7. Time pressure

Feathers' honest chapter: under pressure, sprouting feels slower than editing in place. It is not. The sprouted function has a test by construction and the monster did not get worse. The move that is actually faster under pressure is the one that never pays off: adding the branch inline, with "refactor later" in the PR. Reviewers should treat that sentence as a request for the sprout.

Two things are always allowed, pressure or not: delete dead code (the compiler and the dead-export tool tell you), and write the note in the PR description about what the monster does that you learned the hard way. That note becomes the architecture record.
