# Context Fabric and Edit Prediction

Context Fabric registers context providers, resolves references, and admits bounded contributions
for model tasks. It is the one resolution path for a sent message, the editor's edit prediction and
every text-input ghost surface. Edit Prediction uses it to propose validated same-file edits from
the current buffer, recent edits, linked resources and what the user has open.

**Boundary:** Registration never injects content by itself. A destination must call the manager with
a trusted user, session, workspace, deadline, and byte budget.

## Terminology

| Term                 | Meaning                                                            | Boundary                                              |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Context reference    | A binding target (kind, token, URI, attributes) plus minted scope  | It does not authorize the URI                         |
| Completion reference | The client's name for a reference, tagged `linked` or `ambient`    | The server mints the scope; the client cannot         |
| Working set          | The ambient references for what is open on screen                  | Attached by the hub, not by a surface                 |
| Fallback resolver    | A generic resolver consulted after every specific one              | It never shadows a plugin's resolver                  |
| Context contribution | Provider output considered for one model task                      | Host admission may drop it                            |
| Automatic provider   | A provider selected by destination without an explicit reference   | It runs only when registered and enabled by default   |
| Explicit resolver    | A provider selected by `supports(reference, destination)`          | It runs only for an explicit reference                |
| Admission            | Host policy that accepts or drops a contribution before packing    | Opaque resources receive no filesystem interpretation |
| Hunk                 | One validated inclusive line-range replacement in the current file | It cannot target another file                         |
| Single-flight        | One shared computation for concurrent identical cache keys         | The cache is process-local                            |

## What you can do

| Module                   | Mechanism                                                                                       | Boundary or failure mode                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Plugin SDK context types | Define references, contributions, providers, destinations, scopes, and sensitivity              | Types do not authorize a URI or filesystem path                                     |
| Provider registry        | Validates declarations and indexes `provider.id@provider.version`                               | A malformed or colliding plugin registration becomes a content-free diagnostic      |
| Context manager          | Runs automatic providers or explicit resolvers, then admits and packs output                    | Provider timeout or failure removes that provider's output, not the whole operation |
| Admission policy         | Rejects secret-shaped content and confines declared filesystem sources with `realpath`          | Opaque URIs without `source.path` are not interpreted as filesystem paths           |
| Binding capture          | Resolves every message binding through Fabric, keyed by the binding's own id                    | A binding without content is named in the turn with its reason                      |
| Host-reference resolver  | Serves core kinds (file, snippet, session, message, …) through the existing expanders           | A file contribution carries `source.path`, so workspace exclusions apply            |
| Completion references    | Mints client-named references and ranks ambient ones below linked ones                          | Shared by edit prediction and every text-input surface                              |
| Completion context       | Admits raw contributions, ranks them against the typed words, excerpts, then budgets            | A large contribution is excerpted, not dropped before ranking                       |
| Edit Prediction engine   | Resolves context, builds one strict-JSON prompt, calls the auxiliary model, and validates hunks | Truncated, malformed, stale, reversing, or empty output produces no edit            |
| Result cache             | Shares identical in-flight predictions and caches successful outcomes in memory                 | Cancellation and provider failures are never cached                                 |

The load-bearing invariant is that provider output is data. The host verifies identity, declared
sensitivity, scope, containment, secret shape, quotas, and global budgets before serialization.

## How it works

### Register a provider

A backend contributes either a `ContextResolver` for explicit references or an
`AutomaticContextProvider` for destination-triggered context. The declaration names its
destinations, activation, default state, token quota, timeout, and maximum sensitivity.

`createContextProviderRegistry` copies destination arrays and accepts one live registration per
provider ID and version. Automatic declarations may narrow their provider's destination and
sensitivity surface; they cannot widen either one after registration.

Only automatic providers with `defaultEnabled: true` run through `collect`. Explicit resolvers run
only when `resolveExplicit` finds one whose `supports` method accepts the reference and destination.
The registry lists specific resolvers before any declared `fallback`. Core's generic resource bridge
is one of these fallbacks. It registers at boot, before plugins load, so first-match order would
otherwise let it answer every URI a plugin resolver was written for.

A plugin declaration may request at most 8,000 tokens. Core's own resolvers may declare up to
500,000. The host-reference resolver reads whatever the user linked, and a cap sized for plugins
would drop every file over about 32 KB.

### Resolve and admit contributions

```text
task request + trusted scope
  → destination registry lookup
  → provider call under host cancellation and deadline
  → provider identity, sensitivity, and quota checks
  → secret and filesystem admission policy
  → URI/range dedupe and deterministic priority order
  → byte/item packing
  → admitted contributions + aggregate diagnostics
```

Automatic providers run independently. Explicit references use bounded concurrency four and retain
input order in their outcomes. Each explicit reference is read once; the manager does not call the
resolver's `estimate` method before `resolve`.

Filesystem-backed contributions must declare `source.path`. The policy resolves both the trusted
workspace root and source path, rejects symlink escape, and excludes `.git`, `.localix`, dependency,
build, cache, credential, and configured relative paths. Contributions without filesystem provenance
still cross sensitivity, secret-shape, URI, quota, and byte checks.

Packing deduplicates by URI plus range. Active URI, higher priority, then stable ID determine the
packed order; lower sensitivity breaks an equal-priority duplicate. Diagnostics expose reason
counts; per-reference capture stores typed outcomes without provider exceptions or resource labels.

### Capture message bindings

`captureContextBindings` reads each binding target as a Fabric reference with the binding's own id.
It resolves the whole set in the session's scope and effective workspace (`resolveContextWorkspace`,
which also merges user and project exclusions). Packing then fits it into one byte budget per turn.
Keying by binding id removes both token matching and duplicate-chip special cases.

A binding whose reference was unsupported, empty, out of scope, timed out, aborted, errored or
denied still reaches the model, as an absence note that names the reason. A resolver that could only
report a failure produces an `unavailable` contribution, and the binding records an `error` status.
The resolved binding lifecycle and replay rules belong to [Message bindings](message-bindings.md).

### Ground a completion

Every completion surface gets its context from the same three sources. A new field therefore needs
no context code:

```text
working set (open tabs, live view facets)     → ambient references, attached by the client hub
surface anchors (composer chips, SQL tables)  → linked references
surface grounding (transcript, change set)    → contributions from the surface itself
  → Fabric resolveExplicit / collect under destination edit-prediction or inline-completion
  → admission, then ranking against the words being typed, then excerpting, then the prompt budget
```

The client working set is `completionWorkingSet()`, which the grid provides at startup from the same
ranked bindings the composer shows as ambient chips. For an editor it leaves out the editor's own
tab. The hub folds the working set into its fingerprint and cache keys, so an answer produced beside
one open file is never reused beside another. Plugin editors receive the working set through the
host's `pluginEditor.predictNextEdit`. Plugin text fields receive it through
`usePluginTextInputCompletion`.

### Produce an edit prediction

The Monaco adapter waits 100 ms, rejects ineligible automatic requests, and sends the current file,
cursor, document version and digest, same-file edit history, the host's anchors and the working set.
Automatic prediction is skipped above 500,000 document characters; an explicit request may proceed.

The backend performs these steps:

1. resolve the configured `inlineCompletion` auxiliary model;
2. resolve the session's trusted workspace boundary;
3. collect the core active-document and edit-history contributions;
4. resolve the anchors and working set through Context Fabric, as raw material of up to 512 KiB;
5. excerpt that material around the symbols near the cursor, render the canonical strict-JSON
   prompt, and call the model;
6. reject truncated output and validate each proposed line range;
7. drop overlaps, no-ops, prompt scaffolding, and edits that reverse recent work;
8. return at most four same-file hunks.

The frontend revalidates each hunk against the live buffer before display. Monaco owns inline-edit
preview, acceptance, rejection, cancellation, and version races. After one hunk is applied, shifted
survivors are checked again; drifted survivors are discarded.

### Cache successful outcomes

The frontend keeps eight digest-and-cursor entries per editor. The backend adds a nominal 512 KiB
in-memory LRU keyed by user, workspace, document version and digest, cursor, edit history, rendered
context, model, connection, and protocol versions.

Identical concurrent backend keys share one model call. The shared call is cancelled only after its
last subscriber leaves. `predicted` and `empty` outcomes are cacheable; transient outcomes are not.

## Configuration

### Context Fabric

| Control                             |             Value | Boundary                                            |
| ----------------------------------- | ----------------: | --------------------------------------------------- |
| Plugin provider token declaration   |    1–8,000 tokens | Enforced as a four-bytes-per-token output quota     |
| Core provider token declaration     |  1–500,000 tokens | Core's own resolvers only                           |
| Plugin provider timeout declaration |        1–5,000 ms | Clipped by the operation deadline                   |
| Manager result ceiling              | `maxItems`, def 8 | Set by the request; a sent message packs every chip |
| Explicit resolver concurrency       |                 4 | Result order remains input-stable                   |
| Chat capture budget                 |             4 MiB | One sent message, every binding                     |
| Chat capture deadline               |          5,000 ms | Covers the authoritative resolution                 |
| Completion raw context              |           512 KiB | Material before excerpting, not the prompt budget   |
| Completion references per call      |                12 | Linked first; the cap trims ambient ones first      |

### Edit Prediction

| Constant or control                   |                       Value | Boundary                                                        |
| ------------------------------------- | --------------------------: | --------------------------------------------------------------- |
| `MAX_EDITS`                           |                     4 hunks | Applies to parsed model output                                  |
| `MAX_TOKENS`                          |         1,024 output tokens | Also clipped by adapter capability                              |
| `NEXT_EDIT_DEADLINE_MS`               |                    8,000 ms | Covers context and model completion                             |
| `CONTEXT_CHAR_BUDGET`                 |                       8,000 | Used as bytes in Fabric and characters in prompt-window packing |
| `MAX_CONTEXT_WINDOWS`                 |                   8 windows | Applied during prompt packing                                   |
| `MAX_CONTEXT_CHARS`                   | 1,500 characters per window | Prevents one supporting block from dominating                   |
| `PROMPT_WINDOW_LINES`                 |                 1,200 lines | Larger files use a cursor-centered window                       |
| `PROMPT_WINDOW_RADIUS`                |                   600 lines | Maximum context on each side of the cursor                      |
| `PROMPT_WINDOW_BYTE_CEILING`          |                      64 KiB | The cursor line may exceed it by itself                         |
| Backend positive / negative cache TTL |                 90 s / 10 s | In-memory only                                                  |
| `LOCALIX_EDIT_PREDICTION_TELEMETRY`   |           Off unless truthy | Writes metadata-only outcomes to the process console            |

## Limits

- Context Fabric has no general retrieval index. Providers must register concrete automatic or
  explicit mechanisms.
- The manager requires `estimate` on explicit resolver declarations but does not call it during
  explicit resolution. Actual output is checked against the provider quota instead.
- Token quotas use a four-bytes-per-token approximation. They are not provider tokenizer counts.
- Opaque resources without `source.path` do not receive filesystem containment checks. Their scheme
  owner remains responsible for resource authorization.
- Sensitive contributions are denied by the current manager calls. No destination opts into them.
- The working set is ranked on the client (visible, focused, recent). The server ranks only by
  lexical overlap with the typed text, so a synonym or cross-language match gets no boost.
- Edit Prediction is same-file only. Supporting context can inform a hunk but cannot target another
  file.
- The model sees a bounded window for large files, while validation uses the full live file. A
  single oversized cursor line can exceed the 64 KiB prompt-window ceiling.
- Both prediction caches are process memory. Restarting the UI or API clears them.
- The backend cache's nominal 512 KiB ceiling uses `JSON.stringify(value).length`, not encoded byte
  length. Non-ASCII results can occupy more memory than the label implies.
- The engine performs one model attempt. A retryable provider classification exists in the adapter,
  but the engine does not retry it.

## Related guides

- [Edit Prediction internals](edit-prediction.md)
- [Context system](context-system.md)
- [Active-tab context](active-tab-context.md)
- [Message bindings](message-bindings.md)
- [Plugin authoring](../../extending/plugins.md)

## Source of truth

- [Public provider contracts](../../../packages/plugin-sdk/src/backend/context-fabric.ts)
- [Registration validation](../../../apps/api/src/features/context-fabric/contribution-validate.ts)
  · [registry](../../../apps/api/src/features/context-fabric/registry.ts)
- [Resolution and packing](../../../apps/api/src/features/context-fabric/manager.ts)
- [Filesystem and secret policy](../../../apps/api/src/features/context-fabric/policy.ts)
- [Binding capture](../../../apps/api/src/features/context-fabric/binding-capture.ts) ·
  [host-reference resolver](../../../apps/api/src/features/context-fabric/host-ref-resolver.ts) ·
  [session workspace](../../../apps/api/src/features/context-fabric/session-workspace.ts) ·
  [chat-service wiring](../../../apps/api/src/bootstrap/chat-service-deps.ts)
- [Completion references](../../../apps/api/src/features/autocomplete/completion-references.ts) ·
  [completion context packer](../../../apps/api/src/features/autocomplete/completion-context.ts) ·
  [client working set](../../../apps/ui/src/shared/api/completionWorkingSet.ts)
- [Core automatic provider](../../../apps/api/src/features/autocomplete/edit-prediction-context-provider.ts)
- [Prediction orchestration](../../../apps/api/src/features/edit-prediction/engine.ts)
- [Prompt and parser](../../../apps/api/src/features/edit-prediction/prompt/build.ts) ·
  [reply parser](../../../apps/api/src/features/edit-prediction/parse.ts)
- [Backend cache](../../../apps/api/src/features/edit-prediction/cache/contracts.ts) ·
  [memory implementation](../../../apps/api/src/features/edit-prediction/cache/memory.ts)
- [Live editor driver](../../../apps/ui/src/shared/ui/code-editor/monaco/editPrediction.ts) ·
  [prediction data model](../../../apps/ui/src/shared/ui/code-editor/nextEditPrediction.ts)
