# Patterns in TypeScript: object-oriented intent, functional shape

Sources: Design Patterns (Gamma, Helm, Johnson, Vlissides) and the functional programming reading of it. The GoF principles survive unchanged: program to an interface, favor composition over inheritance, encapsulate what varies. The shapes change: in this codebase an "interface" is a type, a "strategy" is a function value, a "registry" is an `as const` object checked with `satisfies`, and the compiler is the fitness function.

## 1. Encapsulate what varies: variation is a table, not a branch

The smell that costs this repo the most: the same union (`nodeType`, `triggerType`, a status) branched on in dozens of files, each with its own `switch` or if-chain, half of them with a silent `default`. Adding a kind means finding every site; forgetting one compiles and misbehaves.

The move is Replace Conditional with Polymorphism, in its functional form:

```ts
// Smell: one of many
function labelFor(type: NodeType): string {
  switch (type) {
    case 'code':
      return 'Code';
    case 'tool':
      return 'Tool';
    default:
      return 'Node'; // silent on a new member
  }
}

// Move: one entry per kind, exhaustive by construction
export const NODE_SPECS = {
  code: { label: 'Code', creatable: true, async: false },
  tool: { label: 'Tool', creatable: true, async: true },
  // ...
} as const satisfies Record<NodeType, NodeSpec>; // missing member = compile error
```

Rules that follow:

- A new kind is a new **entry**, never a new **arm**. If the table does not exist, create it with the existing kinds and yours; do not add a third `case` to a `switch` that already has two.
- Where a `switch` is the right tool (the operation is local and single-use), it ends in an exhaustiveness guard (`exhaustiveGuard(x)` / `x satisfies never`), never `default: break`.
- `Record<string, …>`, `Partial<Record<Union, …>>`, and `['a', 'b'].includes(type)` are the stringly versions of the same smell. `Partial` turns a compile error into a runtime throw; use it only when the absence is a real state, and say what happens then.
- Behavior that belongs to a kind (validate, execute, render, default config) is a function-valued field on its entry. This is the Strategy pattern; a class hierarchy is not needed and would make the table harder to see.
- Traits that cut across kinds (`listMode`, `async`, "acts as a map") are boolean or enum fields on the entry, queried as `spec.async`, never re-derived as `type === 'a' || type === 'b'` at call sites.

The expression problem, stated plainly: objects make it cheap to add kinds and expensive to add operations; `switch` makes it cheap to add operations and expensive to add kinds. The registry table with function fields pays both costs once, at the table.

## 2. State is a transition table

The State pattern's intent (behavior depends on state; transitions are explicit) maps to a data table, not to one class per state:

```ts
const STEP_TRANSITIONS = {
  pending: ['active', 'cancelled'],
  active: ['waiting', 'completed', 'failed', 'pending'],
  waiting: ['pending', 'failed', 'cancelled'],
  // ...
} as const satisfies Record<StepStatus, readonly StepStatus[]>;
```

One helper owns every write of the status column, consults the table, stamps the clock, the generation, the lease, and emits the event. Every other module calls the helper and never writes the column. The check is a lint rule or architecture test on the column's writers; the table is the documentation.

## 3. Commands are job payloads; results are discriminated unions

- A queue job payload is a Command: serializable, replayable, carrying its own idempotency key. Design the payload for a worker that knows nothing but the payload and the database.
- A function that can end in several non-error ways returns a discriminated union (`{ type: 'transitioned', … } | { type: 'waiting', … } | { type: 'terminal', … }`), and the single consumer `switch`es exhaustively. Errors are thrown as domain error classes. Do not mix the two: an error class for a normal outcome forces try/catch control flow; a union member for a bug hides it.
- Make illegal states unrepresentable: `{ status: 'waiting'; deadlineAt: Date; pendingKind: PendingKind } | { status: 'completed'; completedAt: Date }` instead of one object with five optional fields and a comment saying which go together.

## 4. Pure core, imperative shell

The functional-core/imperative-shell split is how the layering in `architecture.md` shows up inside one module:

- **Core**: pure functions over plain data. Graph traversal, input resolution, priority computation, transition legality, config defaults. Deterministic, trivially unit-tested, no `await`.
- **Shell**: the function that loads data, calls the core, persists the result, publishes. Thin, integration-tested.

Rules: a module in `domain/` is core and imports no client; `await` inside a core function is the smell. A shell function with more than one `if` on domain data is hiding core logic; extract it. Parse at the boundary (Zod on inputs, callbacks, queue payloads) so the core works on typed values and never re-validates ("parse, don't validate").

Immutability inside the core: return new objects; do not mutate `step.data` or a config in place and then persist "the same" object. Spreading into an open record is where unknown keys leak in; if a record is open (`z.record`), the runtime-trusted keys live under one namespaced key the core owns.

## 5. The rest of the catalog, by what it is here

| GoF pattern             | Shape in this repo                                                                  | Use it when                                                               | Not when                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Facade                  | `apps/api/v3/<domain>` as a ts-rest facade over a service's internal tRPC           | Callers need one entry point and the service's surface is not user-facing | The facade starts holding logic or its own database reads           |
| Adapter                 | `src/client/*.client.ts` wrapping an SDK or another service                         | The outside shape should not leak into services; one place to mock        | Two adapters for one dependency ("one Clay API client" is a rule)   |
| Decorator               | Procedure middleware, instrumented wrappers, `withX(fn)` helpers                    | Cross-cutting: tracing, auth, retries, heartbeat                          | The wrapper changes semantics the caller must know about            |
| Observer                | Events published after commit to pub/sub rooms                                      | Consumers must not block or fail the producer                             | The producer awaits the observers                                   |
| Mediator                | The job handler that applies a result union and dispatches successors               | Several parties must be coordinated in one place                          | It grows into a god module; split by result kind                    |
| Factory                 | `build<X>Config(type)` returning the exhaustive default for a kind                  | Construction varies by kind                                               | Three copies of the defaults exist (that is Consolidate Duplicate)  |
| Singleton               | Module-level lazy instance for a client, pool, or connection provider               | The resource is expensive or must be unique per process                   | For anything stateless; `new` at the use site is simpler            |
| Memento                 | Workflow snapshots: an immutable copy a run executes against                        | Execution must not observe later edits                                    | Snapshotting per step; snapshot once per publish                    |
| Composite               | Subworkflows and node groups: a node that contains a graph                          | The container must be used where a leaf is                                | A flag on the leaf would do (`listMode` over a new node type)       |
| Chain of Responsibility | Middleware pipelines; trigger handler lookup                                        | Handlers are ordered and optional                                         | Dispatch should be a table lookup (exhaustive), not a chain         |
| Template Method         | A higher-order function taking the varying steps as parameters                      | The skeleton is fixed and the steps vary by kind                          | Inheritance; subclassing to override one step                       |
| Visitor                 | Exhaustive `switch` on a discriminated union in one place                           | One operation over all kinds, in one module                               | The same visitor is copied into ten modules (then it is a registry) |
| Iterator                | Generators / async generators for chunked reads                                     | A caller must stream without holding the set                              | The set is small enough to return                                   |
| Null Object             | A `none`/`disabled` entry in the registry; an empty handler with the real interface | Callers would otherwise `if (x)` everywhere                               | The absence is an error the caller must see                         |

## 6. Dependencies as parameters, not as frameworks

Inversion of control here means a function takes what it needs: a repository function, a clock, a client interface. It does not mean a container. Two rules:

- Inject at the shell, not through the core: the core takes data; the shell takes the collaborators and the core function.
- A dependency passed for testability must have one production implementation and one test double. If it has one implementation and no test uses the seam, inline it.

## 7. Frontend: the same principles in React

- Variation by kind is a registry entry: `{ card, panel, palette, defaults }` per variant key, selected by lookup, lazily loaded. A shared component that takes `mode`, `presentation`, or a growing set of booleans is a `switch` in disguise; the move is Remove Flag Argument, with the variant as the key.
- Data access lives in hooks; components receive data and callbacks. A component calling the API client inline is the shell leaking into the view.
- Form shapes derive from the contract schema (`z.infer`), never from a hand-mirrored type; drift between the two has already shipped bugs.
- Complex interaction state is a reducer with explicit states and events, not a cluster of `useState` plus `useEffect` syncing them (see `apps/frontend/code-agents/REACT_PATTERNS.md`).

## 8. Anti-patterns to name in review

- `nodeType: string` (or any union widened to `string`) in a signature: kills exhaustiveness everywhere downstream. Move: Replace Primitive with Object, here "use the union type".
- A literal union re-declared in several files instead of imported from the Zod enum.
- `as unknown as T` to reconcile two types that should be one.
- A "helper" or "util" module that imports services and infrastructure: a layer violation with a friendly name.
- An inheritance hierarchy introduced for variation that a registry entry expresses.
- A boolean parameter that selects behavior (`fn(x, true)`): Remove Flag Argument; two functions or a kind parameter.
