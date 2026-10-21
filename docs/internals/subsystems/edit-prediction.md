# Edit prediction internals

Edit prediction asks the configured auxiliary model for a small, same-file diff after an editor
change. Use this reference when changing request eligibility, prompt context, validation, caching,
or Monaco delivery.

## Terminology

| Term              | Meaning                                                                    | Boundary                                                        |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Prediction hunk   | One 1-based inclusive line range and its proposed replacement              | A response contains at most four hunks in the current file      |
| Drift baseline    | Current file text re-sliced for a validated hunk                           | Model-supplied `original` text is never trusted                 |
| Edit event        | A recent same-file range with current lines and, when known, prior text    | At most six events enter the prompt                             |
| Context reference | An opaque resource selection resolved by Context Fabric                    | The client cannot supply trusted scope or model-visible content |
| Neutral outcome   | `empty`, `cancelled`, `deadline_exceeded`, `no_model`, or `provider_error` | The editor receives no suggestion and no provider detail        |

## What you can do

| Operation                  | Mechanism                                                                                                                           | Boundary                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Enable predictions         | Turn on the `modelRouting.inlineCompletion` workload and reuse its model route                                                      | The workload is off by default and falls back to the session model     |
| Propose follow-on edits    | Send the open file, cursor, language, and recent same-file edit events over the event socket                                        | The prediction cannot target another file                              |
| Add explicit context       | Pass opaque references for server-side Context Fabric resolution                                                                    | Policy rejects out-of-scope, sensitive, empty, and over-budget content |
| Accept or reject a hunk    | Let Monaco render caret insertions as ghost text and replacements as native inline edits, with Tab, Escape, undo, and accessibility | Rejection clears the bundle; acceptance revalidates remaining hunks    |
| Rotate a multi-hunk result | Use `Alt+]` or `Alt+[` to move another validated hunk to the front                                                                  | Rotation exists only while more than one hunk survives                 |

The [LSP guide](../../features/lsp.md) owns the surrounding editor behavior. Context policy and
extension contracts belong to [Context Fabric](context-and-edit-prediction-architecture.md).

## How it works

```text
Monaco inline-edit provider
  -> predictNextEdit event-socket request
  -> edit-prediction engine and host deadline
  -> auxiliary model resolution
  -> Context Fabric collection and explicit resolution
  -> canonical numbered-file prompt
  -> provider-neutral model adapter
  -> strict JSON parse, live-file checks, and reversal guard
  -> correlated response and Monaco drift validation
```

### Module contracts

| Module                                                                                                  | Mechanism and invariant                                                                                      | Failure when violated                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`nextEditPredictionPolicy.ts`](../../../apps/ui/src/shared/ui/code-editor/nextEditPredictionPolicy.ts) | Blocks empty, read-only, composing, bulk-edit, and oversized-paste states before automatic work              | A model call can interrupt input or follow a non-local edit burst                        |
| [`monaco/editPrediction.ts`](../../../apps/ui/src/shared/ui/code-editor/monaco/editPrediction.ts)       | Owns the 100 ms provider debounce, cancellation generation, local cache, bundle narrowing, and hunk rotation | A stale result can replace newer text or Tab can act on the wrong hunk                   |
| [`editor-assist-client.ts`](../../../apps/ui/src/shared/api/editor-assist-client.ts)                    | Requires protocol version 2 plus matching request id, document version, and digest                           | A late socket reply becomes `stale_delivery`, never an edit                              |
| [`engine.ts`](../../../apps/api/src/features/edit-prediction/engine.ts)                                 | Applies one deadline across context collection and model completion, then returns typed outcomes             | Provider and cancellation failures must not become transport errors or partial edits     |
| [`prompt/build.ts`](../../../apps/api/src/features/edit-prediction/prompt/build.ts)                     | Builds the sole prompt from numbered current-file text, cursor marker, edit events, and admitted context     | A prompt change requires a schema-version cache invalidation                             |
| [`parse.ts`](../../../apps/api/src/features/edit-prediction/parse.ts)                                   | Accepts only `{"edits":[...]}`, optionally inside a JSON fence                                               | Bare arrays, single objects, malformed JSON, and missing envelopes produce no prediction |
| [`validate.ts`](../../../apps/api/src/features/edit-prediction/validate.ts)                             | Re-slices live text, strips echoed scaffolding, drops invalid/no-op/overlapping hunks, and sorts survivors   | A malformed or conflicting hunk must not reach the editor                                |
| [`reversal.ts`](../../../apps/api/src/features/edit-prediction/reversal.ts)                             | Drops a hunk that exactly restores the recorded pre-edit text of an overlapping recent event                 | The assistant can offer to undo the change that triggered it                             |
| [`cache/memory.ts`](../../../apps/api/src/features/edit-prediction/cache/memory.ts)                     | Caches successful outcomes by bounded bytes and shares identical in-flight computation                       | A transient failure can be pinned or one subscriber can cancel every subscriber          |

### Prompt and validation

`numberFileForPrompt` keeps absolute 1-based line numbers. Files above 1,200 lines use a 600-line
radius around the cursor. The rendered window is reduced until it fits 64 KiB; the cursor line is
retained even when that single line exceeds the ceiling. Validation still uses the complete live
file.

The prompt accepts at most 8,000 context characters across eight ranked windows, with 1,500
characters per window. Edit-event formatting keeps six recent events within 2,000 characters.
Context Fabric resolves the effective session workspace on the server before applying containment,
exclusion, sensitivity, provenance, and quota policy.

Each response item must contain integer `startLine` and `endLine` values plus a string
`replacement`. Invalid items are dropped independently. Earlier response items win overlap
conflicts; surviving hunks are sorted by start line. A truncated model response is rejected before
parsing.

### Cache and delivery

| Layer          | Key or policy                                                                                                | Retention and boundary                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Editor cache   | FNV-1a content digest plus cursor line and column                                                            | Eight entries; positive 90 seconds, empty 10 seconds                   |
| Backend cache  | SHA-256 of user, workspace, document revision, cursor, edit history, rendered context, model, and connection | 512 KiB LRU; positive 90 seconds, empty 10 seconds                     |
| Single-flight  | Identical backend keys share one computation                                                                 | Shared work aborts only after the last subscriber leaves               |
| Provider cache | Adapter reports `promptCaching: 'none'`                                                                      | Per-keystroke file content is not retained as a provider prompt prefix |

Only `predicted` and `empty` enter the backend cache. Cancellation, deadline, model-resolution, and
provider failures remain transient. Usage records use the `autocomplete` auxiliary kind.

The editor likewise does not cache failed requests as empty predictions. A failed request does not
block later typing. `Alt+Backslash` explicitly requests a suggestion and bypasses the local result
cache. Rejection suppresses automatic offers for that document version until another edit or an
explicit request. Changing the prediction source clears suppression too; a rejection callback from
an older document cannot suppress the newer version. Manual invocation requests a fresh answer even
when a previous bundle is pending. An insertion that preserves all text before and after the caret
renders as ordinary Monaco ghost text; other changes retain the native diff preview.

Inline authorship uses a content widget rather than injected model text. It remains visible at the
end of the current line, anchored after injected ghost text, leaving caret layout independent of
author metadata. Committed lines expose the provider's action to open the commit diff by click or
keyboard; uncommitted lines remain plain annotations.

## Text-input surfaces

Chat and the Git Workspace commit subject use the shared
[`useInlineCompletion.ts`](../../../apps/ui/src/shared/hooks/useInlineCompletion.ts) lifecycle and
[`suggestCore.ts`](../../../apps/ui/src/shared/api/suggestCore.ts) hub. The adaptive pause is
150–350 ms. Each surface caches its own context/draft key: positive replies last 60 seconds, empty
replies 10 seconds. Only uncached surfaces enter the next model call. An empty reply never starts a
retry timer; transient failures have a two-attempt budget per draft.

`Alt+Backslash` requests again, Tab accepts, Escape dismisses, Ctrl+Right accepts a word and
Ctrl+Shift+Right accepts a line. Composition, inactive/read-only chat, caret position and focus gate
automatic work. Late replies may survive exact prefix typing within the same session and context.

An EMPTY chat composer predicts only one thing: the person's reply to the agent's last message
([`replyPrediction.ts`](../../../apps/ui/src/entities/chat/ui/prompt-input/replyPrediction.ts)).

| Rule    | What it says                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Subject | The last visible message is the agent's and has words in it — not the person's line, a notice or tool rows |
| Quiet   | Nothing else waits on the person: no queued message, interaction card or question in the strip             |
| Fresh   | The reply was watched being written, or is under 15 minutes old — opening an old chat costs nothing        |
| Timing  | 2.5 s after the reply settles, focused or not, so the ghost is there when the person reaches the input     |
| Once    | Keyed by the message alone; a title or usage update is not a new question. Escape hides it until the next  |

The digest keeps the END of the last turn (900 bytes) — a reply answers how a message ends — and the
empty-draft instruction asks for that reply, or `""` when the message invites none.

The canonical prompt is [`suggest/prompt.ts`](../../../apps/api/src/features/suggest/prompt.ts).
Each response line holds a labeled JSON string, preserving insertion whitespace and escaped
newlines. Chat keeps the last 400 UTF-8 bytes of the draft, including unfinished words. Chat context
reads a bounded eight-message tail instead of hydrating the full transcript. Model resolution and
surface context reads run in parallel after checking the route. Commit cancellation propagates to
Git child processes. The model call itself sits behind a server result cache with single-flight
([`model-call.ts`](../../../apps/api/src/features/suggest/model-call.ts), on the same
[`result-cache.ts`](../../../apps/api/src/lib/result-cache.ts) edit prediction uses): the identical
prompt on the same model route is answered once and billed once, for ten minutes (two for an empty
answer).

Every surface uses the SDK's one suffix cleaner. It strips an echo of the draft's end on a word
boundary, whether the model repeats the whole draft, its last words or only the unfinished word
("fix the te" + "test suite" inserts "st suite"). It also removes a leading space when the draft
already ends in one, drops leaked `<think>` blocks, and never changes case.

Context comes in two kinds
([`surface-context.ts`](../../../apps/api/src/features/suggest/surface-context.ts)):

- A surface's own grounding, such as the chat transcript or a commit's change set, is admitted
  through Context Fabric and clipped by core to 12 KiB for every surface alike.
- The shared working set is the open tabs plus the composer's linked chips. It resolves through
  Fabric under the `inline-completion` destination and is excerpted against the words in the
  surfaces' fragments. It is rendered once per call, however many surfaces the call serves.

A plugin field needs two declarations. Its backend lists a `PluginTextInputCompletionSurface` in
`BackendSubsystem.textInputCompletionSurfaces`, with an id namespaced by the plugin. Its UI calls
`usePluginTextInputCompletion` from the SDK. Any number of plugins may contribute surfaces side by
side.

Text transport reports `suggested`, `empty`, `cancelled`, `timeout`, `disabled`, `no_model`, or
`error`, keeping failures out of the normal empty-result cache. Metadata-only timing and
accept/dismiss events appear under `localix.inline-assist.input` and `localix.inline-assist.editor`
in browser Performance entries; they contain no draft or file text.

Streaming/FIM model paths, smaller editor context budgets, context caches with explicit revisions,
and measured p50/p95 comparisons remain experiments; the current implementation does not claim
provider latency or quality improvements from these unmeasured alternatives.

## Configuration

| Setting or constant                            | Current value      | Effect                                                            |
| ---------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `modelRouting.inlineCompletion.enabled`        | `false` by default | Removes the editor source entirely while disabled                 |
| `MAX_EDITS`                                    | `4`                | Caps response items and validated survivors                       |
| `MAX_TOKENS`                                   | `1024`             | Caps model output                                                 |
| `NEXT_EDIT_DEADLINE_MS`                        | `8000`             | Covers context collection and model completion                    |
| `PROMPT_WINDOW_LINES` / `PROMPT_WINDOW_RADIUS` | `1200` / `600`     | Bounds the numbered file window by lines                          |
| `PROMPT_WINDOW_BYTE_CEILING`                   | `65536`            | Shrinks wide-line windows around the cursor                       |
| `LOCALIX_EDIT_PREDICTION_TELEMETRY`            | Off by default     | `1`, `true`, `yes`, or `on` enables metadata-only outcome logging |

Changing prompt semantics must increment `EDIT_PREDICTION_SCHEMA_VERSION` in
[`cache/keys.ts`](../../../apps/api/src/features/edit-prediction/cache/keys.ts). This invalidates
backend entries without introducing parallel prompt versions.

## Limits

- Predictions are same-file only. Open tabs and the host's anchors inform a hunk as excerpted
  context, but no LSP-definition retrieval path exists.
- Automatic requests stop for editor models above 500,000 characters. An explicit Monaco request
  bypasses that size check but still respects empty, read-only, and composition gates.
- The feature is an auxiliary model call, not an agent tool. It can incur provider usage even when
  every returned hunk is rejected.
- The editor shows no diagnostic for neutral outcomes. Metadata-only telemetry is opt-in and does
  not include file text, paths, prompts, resource identifiers, or model output.
- Context references are capped at eight. Unresolved or rejected references do not fail the whole
  prediction.
- Applying one hunk shifts later line numbers and rechecks their baselines. Drifted survivors are
  discarded instead of re-anchored across arbitrary content.
- The shared `inlineCompletion` model route serves file/SQL prediction and composer/commit
  suggestions.
- All inline completion surfaces request reasoning off, regardless of stored route or session
  effort. The runtime uses the model's lowest supported level when reasoning cannot be disabled.
  Where that reasoning shares the output ceiling (OpenAI Completions and Responses, Codex, Gemini),
  the adapter adds that level's thinking budget to the ceiling. Otherwise the reasoning would
  consume the 64-token answer and every suggestion would end in `max_tokens`.

## Related guides

- [Context Fabric and Edit Prediction architecture](context-and-edit-prediction-architecture.md)
- [Context system](context-system.md)
- [LSP](../../features/lsp.md)
- [Cost tracking](../../features/cost-tracking.md)

## Source of truth

- [Request, limits, and outcomes](../../../apps/api/src/features/edit-prediction/contracts.ts) ·
  [engine.test.ts](../../../apps/api/src/features/edit-prediction/engine.test.ts)
- [Prompt and parsing](../../../apps/api/src/features/edit-prediction/prompt/build.ts) ·
  [predict-next-edit.test.ts](../../../apps/api/src/features/edit-prediction/predict-next-edit.test.ts)
- [Model adapter](../../../apps/api/src/features/edit-prediction/model/adapter.ts) ·
  [model/adapter.test.ts](../../../apps/api/src/features/edit-prediction/model/adapter.test.ts)
- [Backend cache](../../../apps/api/src/features/edit-prediction/cache/memory.ts) ·
  [cache/cache.test.ts](../../../apps/api/src/features/edit-prediction/cache/cache.test.ts)
- [Composition and telemetry](../../../apps/api/src/boot/aux-assist.ts) ·
  [predict-next-edit-telemetry.ts](../../../apps/api/src/features/autocomplete/predict-next-edit-telemetry.ts)
- [Editor integration](../../../apps/ui/src/features/inspector/ui/useFileLsp.ts) ·
  [monaco/editPrediction.test.ts](../../../apps/ui/src/shared/ui/code-editor/monaco/editPrediction.test.ts)
