# Refactoring: smells this repo has and the move for each

Sources: Refactoring, 2nd edition (Fowler) and the online catalog at refactoring.com/catalog. Use the catalog names in PRs and reviews; they are shared vocabulary and each one has a defined mechanics page.

## 1. Two hats, and when to put the refactoring hat on

Fowler's rule: you are either adding behavior or restructuring, never both in one step. Here that is one PR per hat. A refactoring PR has a diff that changes no test expectations (characterization tests stay green, query budgets stay equal) and a description that names the catalog moves. A feature PR then changes behavior against the new shape. Reviewers can verify each; a mixed PR cannot be verified at all.

When to refactor:

- **Preparatory**: the change you need is hard because of the shape. Refactor first ("make the change easy, then make the easy change"). This is the default for anything landing inside a function over about 300 lines.
- **Comprehension**: you had to read it three times. Rename, extract, add the explaining variable, in a small PR, so the next reader does not.
- **Litter-pickup**: small, in-scope, same PR only when it is a rename or an extract inside the function you are already changing. Anything that moves code across files is its own PR.

When not to: code you do not need to touch and cannot test, and anything where a rewrite of a small, well-bounded module is cheaper than ten moves. Say which in the PR.

Mechanics: small steps, run the tests after each, commit often. If a step breaks something, revert the step, not the PR.

## 2. Smell → move, with the shape it takes here

| Smell (Fowler ch. 3)              | How it looks in this repo                                                                                                                 | Move(s)                                                                                                                                             | Check after                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Repeated Switches                 | The same union branched on in dozens of files; `default` arms that silently skip a new kind                                               | Replace Conditional with Polymorphism (as a `satisfies Record` registry); Replace Type Code with Subclasses becomes "exhaustive table entry"        | A `satisfies Record<Union, …>`; a lint rule on `switch` without exhaustive guard |
| Shotgun Surgery                   | Adding a kind touches twenty files, half of them compile-silent                                                                           | Move Function into the registry entry; Combine Functions into Class → one entry object per kind                                                     | Parity test: enum members == registry keys; runbook shrinks                      |
| Long Function                     | 1,900-line executor; 3,000-line sidebar component; 4,000-line service file                                                                | Extract Function (pure parts first), Introduce Parameter Object (the context), Decompose Conditional, Replace Nested Conditional with Guard Clauses | File-size and complexity ratchet; diff of the monster file is small              |
| Divergent Change                  | One module changed for unrelated reasons (persistence rules and LLM prompt wording in the same file)                                      | Extract Class / Split module by reason to change; Move Function to the layer that owns it                                                           | Layer rule; `git log` of the file stops mixing concerns                          |
| Duplicated Code                   | Three copies of a kind's default config; a literal union re-declared in thirteen files; two topological sorts with different cycle policy | Extract Function to one owner, Slide Statements to bring copies together first; import the Zod enum instead of re-declaring                         | Clone detector; "re-declared literal union" lint                                 |
| Primitive Obsession               | `nodeType: string`; ids as bare strings mixed up in signatures; `mode: string`                                                            | Replace Primitive with Object, here: use the union or branded type; Change Function Declaration to the narrow type and follow the compiler          | Type check                                                                       |
| Flag Argument / Mode props        | `fn(x, true)`; `<Sidebar mode="trigger" isCompact readOnly />` growing a prop per scenario                                                | Remove Flag Argument: separate functions or a kind key resolved through the registry                                                                | Lint on new boolean/mode props to shared components                              |
| Data Clumps / Long Parameter List | `(step, run, snapshot, trigger, inputs)` passed through six functions                                                                     | Introduce Parameter Object (`StepContext`); Preserve Whole Object where the callee needs most of it                                                 | Signature count; `long_params` detector                                          |
| Mutable Data / Global Data        | `step.data` as an open record mutated in place and persisted; a module-level cache mutated from several places                            | Encapsulate Record (one owner for the record's shape), Encapsulate Variable, Separate Query from Modifier; namespaced runtime-trusted keys          | Type: closed object for the trusted part; writes through one helper              |
| Derived data stored twice         | Status in a column and in `state.status`; payload stored four times; JSON-path predicates on a column that exists                         | Replace Derived Variable with Query (read the column; compute the copy); then expand/contract to drop the copy                                      | Schema annotation `derived`/`deprecated`; grep rule on the JSON path             |
| Feature Envy                      | A router that reaches into Prisma; an executor that queries tables; a `domain/` file importing `services/`                                | Move Function to the layer that owns the data (repository, service)                                                                                 | Layer rule; data-layer baseline shrinks                                          |
| Insider Trading                   | Service A imports service B's internals (deep imports, private tables) instead of its client                                              | Hide Delegate; Move Function to B and call the published surface                                                                                    | `no-restricted-imports`; platform-review skill                                   |
| Message Chains                    | `ctx.run.workflow.snapshot.content.nodes.find(...)` repeated across callers                                                               | Extract Function on the chain into a query on the owner; Hide Delegate                                                                              | Review                                                                           |
| Middle Man                        | A wrapper that forwards every call and adds nothing (a second client around the one client)                                               | Remove Middle Man; Inline Function                                                                                                                  | "One client" rule                                                                |
| Loops                             | A `for` with filter, map, and reduce logic interleaved and a mutable accumulator                                                          | Replace Loop with Pipeline; Split Loop when two concerns share one loop                                                                             | Readability; unit tests on the pipeline stages                                   |
| Speculative Generality            | Abstract base "handler" with one implementation; a plugin registry nobody registers into; `register()` machinery with static callers      | Collapse Hierarchy; Inline Class; Remove Dead Code; prefer the static table                                                                         | Dead-export tool; "static registry" house position                               |
| Temporary Field                   | Optional fields on a type that are set only in one status (`deadlineAt?`, `pendingKind?`, `leaseOwner?` on every step)                    | Introduce Special Case / discriminated union by status so each state carries only its fields                                                        | Type check                                                                       |
| Large Class                       | A "service" file owning run CRUD, transitions, admission, pause/resume, and exports                                                       | Extract Class per aggregate; Move Function; one concern per file                                                                                    | `god_module` detector; file-size ratchet                                         |
| Comments as deodorant             | A comment explaining a block that should be a function; "keep in sync with X" comments                                                    | Extract Function (name says what the comment said); for "keep in sync", make it one source (Replace Derived Variable with Query) or a parity test   | The comment is gone and nothing is lost                                          |
| Lazy Element                      | A one-line wrapper module; a type alias that only renames                                                                                 | Inline Function / Inline Class; remove deprecated aliases in the same PR as the last caller                                                         | Dead-export tool                                                                 |

## 3. Moves that are really architecture rules

Three catalog entries carry invariants in this repo and deserve their own line:

- **Split Phase** is how "prepare → lock → write → commit → publish/enqueue" is achieved in existing code. First, Slide Statements to pull every read and network call above the lock; then Extract Function for the prepare phase and for the write phase; the lock callback shrinks to database statements. Check: the lock-I/O architecture test.
- **Separate Query from Modifier** is how a step handler stops doing four writes: the queries (load context) become one function with a result; the modifier (persist outcome) becomes one function with one transaction. Check: the per-scenario query budget.
- **Replace Derived Variable with Query** is the expand/contract plan for every column/JSON duplicate: step 1 readers switch to the authoritative copy; step 2 writers stop writing the derived copy; step 3 the copy is dropped. Each step is a deploy.

## 4. Small moves you should always do inline

In the function you are already changing, without a separate PR:

- Extract Variable for a condition that needs a name.
- Replace Nested Conditional with Guard Clauses when you add a case to a nested `if`.
- Rename Variable / Change Function Declaration when the name lies (the compiler finds every caller).
- Replace Magic Literal with a named constant when the literal appears twice.
- Remove Dead Code the compiler or the dead-export tool points at.

## 5. What a refactoring PR description says

The catalog names used, the file(s) that shrank and by how much, the tests that pin behavior (and which characterization tests were added for the purpose), the budgets that stayed equal (query counts, queue ops), and the baseline entries removed. No "cleanup" or "improvements" without a catalog name; a reviewer who cannot map a change to a move cannot verify it preserved behavior.
