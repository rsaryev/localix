# Agent runtime boundary

The agent runtime converts a Localix session into one provider-backed run and returns Localix
events. Localix runs its own engine behind this boundary: an agent loop, model access over the
`@ai-sdk/*` provider packages and the models.dev catalog, and a script sandbox.

## Terminology

| Term           | Meaning                                                          | Boundary                                              |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Session        | Durable Localix messages, configuration, and execution metadata. | One session can contain multiple runs.                |
| Run            | One invocation of `AgentRuntime.run()` for a session.            | A retry starts another invocation.                    |
| Runtime port   | Provider-neutral interfaces in `packages/agent`.                 | The port names no provider SDK.                       |
| Engine         | The implementation behind the port, in `packages/engine*`.       | Localix's own engine is the only production engine.   |
| Model session  | One model bound to its credential for one run.                   | The seam between the loop and model access.           |
| Context policy | A host callback applied before each model request.               | It changes model-facing messages, not the transcript. |
| Agent event    | A Localix lifecycle, message, tool, usage, or error event.       | Delivery uses a bounded buffer.                       |

## Ownership contract

The engine is four packages. Each may import only the packages listed for it; the architecture check
enforces this.

| Package                     | Owns                                                                                                           | May import                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `@localixai/engine-loop`    | Turns, the tool batch scheduler, argument coercion, hooks, nested calls, steering, follow-ups, event buffer.   | `@localixai/agent` only; no provider SDK. |
| `@localixai/engine-models`  | The models.dev catalog, provider SDKs (`@ai-sdk/*`), sign-in flows, credentials, wire shaping, usage, retry.   | `@localixai/agent` and provider packages. |
| `@localixai/engine-scripts` | The script sandbox: a QuickJS VM in a worker thread per `Workflow` script, and the long-lived VMs mods run in. | `@localixai/agent` and `quickjs-wasi`.    |
| `@localixai/engine`         | Composition: `createEngine()` binds a run's model session and hands it to the loop.                            | `@localixai/agent` and the three layers.  |

The Localix host owns session state, modes, tools, permissions, context policy, persistence, and
event publication. It depends on the `AgentRuntime` port, not on the engine's types. Only the
composition root (`apps/api/src/bootstrap/`) imports `@localixai/engine`.

## How it works

```text
session runner
  -> AgentRuntime.run(request, policy, hooks)
  -> engine-loop: turn -> ModelSession.turn() -> tool batch -> turn boundary -> ...
       ModelSession (engine-models): catalog entry -> credential -> LanguageModelV4.doStream()
  -> ordered Localix event stream
  -> API handlers, transcript, and clients
```

The loop sees one model response at a time through `ModelSession`; it never sees a wire format, a
provider, or an SDK. Model access sees exactly those and nothing about turns or tools. A run opens
its session lazily: the catalog lookup, the image preflight, an OAuth refresh or a local model's
download happen before the first request, and a failure there becomes the first turn's failure.

### Run contract

| Surface          | Mechanism                                                                | Boundary                                                                   |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `events`         | An async iterable emits ordered Localix events while the run progresses. | Progress updates for one tool call can be coalesced under buffer pressure. |
| `result`         | A promise resolves to `completed`, `aborted`, or `failed`.               | A failed run can contain settled work from earlier turns.                  |
| `abort()`        | Stops the run; the events that say how it ended are still delivered.     | The host still finalizes its durable run record.                           |
| `beforeToolCall` | The host can block or rewrite a tool call before dispatch.               | Permission policy remains a host responsibility.                           |
| `afterToolCall`  | The host receives the settled result after dispatch.                     | Publication and persistence remain host responsibilities.                  |
| `takeSteering`   | The loop requests queued steering messages between turns.                | The loop first waits until the host has handled every event emitted.       |

The production API constructs the engine in one expression: `createEngine(...)` in
`bootstrap/agent-engine.ts`. The result is an `AgentEngine` — the agent loop, the buffered
completion and decision factory, the script sandbox, the OAuth runtime and the model catalog — and
every phase after it is typed by the neutral ports. A behaviour that needs the real loop is asserted
in the engine packages against a scripted model session.

### How a run is assembled

`executeRun` (`chat/runtime/run/execute-run.ts`) runs the stages in order: admit, turn, view,
context, tools, prompt, intake, history, stream, then complete or fail. Each stage owns one concern;
the stream stage hands everything to `AgentRuntime.run()`.

| Layer           | What it carries                                                                                         | Owner                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| System prompt   | The agent's own instructions, core principles, the host, the protocol of the runtime context.           | `agent-core/prompt/catalog-cached.ts`; goldens in `agent-core/prompt/__golden__/`.            |
| Runtime context | Role, discipline, workspace, skills, formatting, mode and plan, then date and model, tree, jobs, loops. | `agent-core/prompt/catalog-run.ts`, `catalog-tail.ts`, sent as a changed-sections-only block. |
| History         | Turn contexts, media, checkpoint, budget admission.                                                     | `chat/runtime/history/chat-strategy.ts`.                                                      |
| Tools           | Shape and policy resolution, deferral behind `ToolSearch`, the wrapper chain.                           | `chat/runtime/run/tool-assembly.ts`.                                                          |

The system prompt is the same bytes for every kind of run
(`chat/runtime/run/system-prompt-one.test.ts`): only the agent's own instructions differ. What
depends on the run's kind, tools, depth, mode or workspace is in the runtime context, and the tools
are not listed, since their definitions are what the model receives. A subagent or fork with fewer
tools therefore reads the same cached prefix. The `chat` shape names no role, and a shipped persona
says who the agent is.

The host adds facts to a turn, not instructions: what happened, and where to find it. A reminder
says that a background job finished and where its output is stored, or that a language server still
reports errors. It does not restate a rule that the prompt already gives once. Add behaviour to the
prompt section that owns it, not to a situational reminder or a tool-result suffix.

Tool calls pass through mini app hooks, Claude Code hooks, the timeout promoter and the stuck-run
breaker (`chat/runtime/run/tool-wrapper-chain.ts`). The breaker appends nothing before a limit. It
ends a run when one call fails the same way four times, when six calls fail with no success between,
or when one call is issued eight times in a row. A tool that declares `idempotentHint: false` is
compared by its answers as well.

### Reasoning level

The agent's stored route supplies `reasoningEffort` to `AgentRuntime.run()`; a delegated child
snapshots its parent's route. Model access resolves the level on every request against the levels
the catalog lists for the model:

| Requested                        | Sent                                                  |
| -------------------------------- | ----------------------------------------------------- |
| A level the model lists          | That level.                                           |
| A level the model does not list  | The nearest listed level, searching upward first.     |
| Any level, model lists no levels | Nothing: the model reasons, or not, on its own terms. |
| Any level, non-reasoning model   | No reasoning request.                                 |

The levels come from models.dev's `reasoning_options`, read by its authoring rules: an `effort`
option names the levels and `none` among them is `off`; a `toggle` adds `off`; a `budget_tokens`
option offers `low`, `medium`, `high`, and `off` unless its budget has a floor above zero. `off` is
offered only where models.dev says reasoning can be switched off, because sending `none` to a model
that cannot comply is what fails a request. The Anthropic wire always accepts `off`: its SDK
disables thinking, or keeps it as low as the model allows. The catalog publishes the same list as
`reasoningEfforts`, and the shared clamp in `@localixai/agent` (`reasoning-levels.ts`) applies the
same rule, so the picker, `/model` and the server store the level the request will carry.

Buffered completions such as titles and inline completion use the same rule.

### Model catalog

The model list is models.dev's (`https://models.dev/api.json?type=all`), normalized once into a
compact document of Localix's own (`engine-models/src/catalog/normalize.ts`). Localix guesses no
metadata: there is no id pattern or overlay of its own.

| Mechanism   | Behavior                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing     | Each model takes its own `provider.npm`, `provider.api` and `provider.shape` over its provider's (Copilot serves Claude through the Anthropic wire, GPT through Responses). Templated addresses are left out.                      |
| Kinds       | Chat models and, where the provider SDK has a decision model (OpenAI, OpenRouter, AI Gateway), decision models — in separate maps, so one id can be both. Embeddings, images, speech and the rest are left out.                    |
| Context     | The model's input limit, capped at its first long-context price tier, so a growing history is never billed at the higher rate unnoticed.                                                                                           |
| Derived     | The ChatGPT plan through Codex (`openai-codex`), from OpenAI's records with the plan's window; the host's `local` provider, read on every listing.                                                                                 |
| Baseline    | The stored copy; with none, the snapshot shipped in `@opencode-ai/models`, imported only then and stored at once as stale.                                                                                                         |
| Refresh     | A conditional request with the stored `ETag`: an unchanged catalog answers `304` with no body. A fetched one that normalizes to the same document (by digest) changes nothing, so the host hears `changed` only when the list did. |
| Freshness   | A copy checked within 50 minutes is not asked about again; `force` (the manual check) skips that. Concurrent refreshes share one request.                                                                                          |
| Persistence | One entry, `models.dev`, under `~/.localix/model-catalog/`, written atomically: `{ schema, fetchedAt, etag, digest, document }`. An entry of another schema is dropped and rebuilt.                                                |
| Failure     | A failed or malformed fetch keeps the current list and reports the error; an aborted one reports only that.                                                                                                                        |

```text
startup     catalogService.restore() -> engine.refreshCatalog({ allowNetwork: false })
            -> stored document, or the shipped snapshot
idle, hourly catalogService.check() -> engine.refreshCatalog({ allowNetwork: true })
            -> If-None-Match: 304 -> fresh again, nothing changed
                              200 -> normalize -> digest differs -> projection dropped -> next read rebuilds
```

### Provider state across turns

Providers return state the next request must carry back: signed or encrypted reasoning, OpenAI's
item ids, Google's thought signatures. Model access stores the provider SDK's `providerMetadata` for
each part in the message's existing opaque signature fields (`aisdk:` followed by JSON), and replays
it only to the provider namespace that wrote it. Messages stored by earlier runtimes are translated
on the way back. A reasoning part written by one provider is not sent to another.

### Steering and tool checkpoints

The loop passes `SteeringBoundary` to `takeSteering`: the completed turn index and, only after a
successful turn with tool results, the completed tool-turn index. The loop asks only once the host
has handled every event emitted so far, however long its persistence takes, so the turn the boundary
names is already in the transcript when a queued message opens a new assistant row. A stopped run
asks nothing, and the queue stays untouched.

What a running turn may take is the queue's `joins` rule (`wake-queue/kinds.ts`). User messages are
filtered by the current agent's address and must come from the run's client surface. A delegator's
message can amend a running child's assignment. After a completed tool turn, chat runs also take
every report addressed to the running delegator, as one message; only solo chats accept an
unaddressed report. An entry with an independent completion waiter remains on the standalone run
path, and other machine wakes retain their own turns. `LOCALIX_MID_RUN_INTERJECT=0` disables this
mid-run queue consumption.

### Tool deferral

Mini app and MCP tool schemas are the half of the tool list that grows without bound, so they are
deferred: the model sees `ToolSearch` with a compact catalog instead, and activates by exact name.

| Surface            | Mechanism                                                                                                                | Boundary                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Core toolkit       | Assembled core tools remain on the wire after policy and run-shape filtering.                                            | Run shape can still exclude a tool that the host cannot support, such as human-only UI in automation. |
| Deferred tools     | `ToolSearch` advertises them; the loop appends an activated schema before the next model turn.                           | A deferred implementation stays dispatchable, so deferral is a wire decision only.                    |
| Session activation | An activated name is remembered on the session and promoted onto the wire at the start of every later run.               | Bounded per session; the oldest activation is released and the model is told which.                   |
| Surface tools      | A mini app whose tab the person's latest message links, or whose wake the turn answers, brings every tool it registered. | Per turn and never stored; appended after the session's activations, sorted by name.                  |
| The loader itself  | Stays present while any external tool exists, with an empty-catalog description once all are active.                     | Names resolve through the run's own registry, never through the remembered list.                      |

Activation persists on the session rather than being inferred from transcript history. Remembered
names preserve activation order; a later run promotes only names still available in its authorized
registry. Context checkpoints can remove an old activation call without removing the remembered
name. Changes to capabilities, mini app availability, or the activation budget can change the next
run's tool list.

The activator accepts at most eight exact names per call. Unknown names are reported without
preventing known names from activating. Persistence is best-effort: a failed storage write leaves
activation available in the current run, but a later run may need to activate again. Releasing an
old name from the remembered set affects later assembly; the loop only appends revealed schemas and
does not remove them from a run already in progress.

The prompt is assembled once per run from its initial wire roster, including remembered and surface
promotions. Mid-run activation reveals schemas without rebuilding that prompt. The next run builds
its own roster again. Stable ordering can help prompt-cache reuse; it does not guarantee an
unchanged prefix or a fixed token cost or price for activation.

Surface tools follow the current message context and stay outside the session's remembered
activation set. The host stamps a mini app tab binding with `MessageContextBinding.plugin` and a
mini app wake with `plugins` (the field names predate the split).
`apps/api/src/features/chat/runtime/run/surface-tools.ts` reads those owners and promotes their
registered tools for the relevant turn:

- **Tabs come from the person's latest message**, not from the row the run answers. A sub-agent's
  report or a job's exit wakes the session with a row that links no tabs. Reading only that row
  would switch the tool list off and on between each report and reply, and every switch is a full
  cache miss. Closing a tab, or removing its chip, takes effect at the person's next message.
- **A wake's mini app counts for the turn that answers it**, and not after.
- **Names are resolved on the server**, from what each mini app registered. A tab cannot ask for a
  tool its mini app does not own, and a renamed tool arrives under its new name.
- **The list is appended and sorted.** Surface tools follow the session's activations, so a tab
  opening or closing changes only the tail of the list. Moving focus between tabs does not reorder
  it. Cache effects depend on the resulting prompt, tool list, and provider behavior.

### Context and recovery

Each run also reads a names-only project-tree snapshot, carried as the `project-structure` section
of the turn's runtime context. It is limited to two levels, 60 lines, and 1,800 characters; deeper
content is summarized by file count. No file contents are loaded, names are marked as untrusted
data, and discovery failure never blocks the turn. The section is sent again only when the tree
changed, as an appended update, so new files appear without rewriting any earlier request bytes.

| Mechanism                  | Behavior                                                                                                       | Boundary                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Per-request context policy | Localix checks the estimated request budget before each provider call and prunes only near the ceiling.        | A prune asks the next turn for a checkpoint; the stored transcript is unchanged.  |
| Pre-stream retry           | Model access retries a retryable failure before the response has produced any content.                         | Two retries with a 60-second maximum delay, honouring `Retry-After`.              |
| Mid-stream retry           | The host can replay a retryable interrupted response up to two times.                                          | It excludes aborts, rate limits, and context overflow; this is a separate budget. |
| Context-overflow retry     | An overflow or a silently empty run takes a context checkpoint and reruns the turn once, without a model call. | A second failure becomes visible.                                                 |

The [context checkpoints guide](../features/context-checkpoints.md) owns checkpoints, wire pruning,
and model-window behavior.

Both host retry paths persist the last completed tool-turn checkpoint before reloading history. A
completed prefix keeps its original transcript row; the retry receives a fresh response row. Without
a completed prefix, the failed response row is reused and excluded from model history. Checkpoint or
reload failures leave the original failure path in charge. At the final handoff, an aborted
controller or a newer session owner prevents relaunch.

These checkpoints preserve completed turns. They do not guarantee exactly-once execution for a tool
interrupted between an external side effect and its recorded result.

### Persistence

Messages are stored as the durable session transcript. A separate run row records the active engine
invocation and its terminal status so startup can reclassify a run interrupted by process death.
Streaming events are published to clients; they are not maintained as a second durable event
journal.

## Configuration

Runtime settings are assembled in the API bootstrap, not in user settings.

| Setting             | Production value                        | Purpose                                                                  |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `retry`             | `{ maxRetries: 2, maxDelayMs: 60_000 }` | Retries before a response produces content.                              |
| `silence`           | 300 s first byte, 120 s between         | A provider that goes quiet fails the request (`StreamIdleTimeoutError`). |
| `maxBufferedEvents` | `256`                                   | Capacity of the Localix event buffer.                                    |
| `scripts`           | Bundled worker and wasm, when present   | Where the script sandbox finds its files in a packaged app.              |

Context-policy round trips preserve prompt-cache anchors on user, assistant, and tool messages. At
the client/service boundary, failed-retry recovery snapshots cannot overwrite newer stream state.
Authoritative message updates replace corrected tool payloads even when their terminal status is
unchanged.

Stopping a run lifts the event buffer's backpressure rather than discarding what is left: the
consumer still receives the end of every tool call, the turn and the run. A tool gets two seconds to
wind down after a stop; a call still open then is closed with a cancellation result, so no call
outlives its run. A run that does not complete stores its current message before it is finalized.

Post-tool processing keeps the stored text and content parts aligned with the effective result, so
shortened output cannot be replaced by stale pre-hook parts. Human-in-loop requests inherit tool-run
cancellation, including when a tool supplies an additional request signal. Without an explicit
invocation trigger ID, binding materialization selects the last non-internal, non-UI-only user
message; synthetic reminders do not consume its one-shot instruction.

## Limits

- Localix's engine is the only production `AgentRuntime` implementation. The neutral port is an
  architectural seam, not evidence of multiple installed engines.
- Event buffering is bounded. Repeated progress updates coalesce, and a producer that fills the
  buffer before consumption can displace the oldest buffered event.
- Provider refusal headers are captured where the provider SDK exposes the response with its error.
  The engine cannot recover headers it never receives.
- Pre-stream retries, mid-stream retries, and checkpoint reruns have separate gates and counters.
  They do not form one shared attempt budget.
- Context pruning and checkpoints preserve the durable transcript but can remove detail from the
  next model request.
- Package boundaries are checked through source-import rules and TypeScript contracts. They are not
  a runtime isolation boundary.
- Providers models.dev routes through an SDK the engine does not carry (Cohere, SAP AI Core, Bedrock
  Mantle) are not listed, nor models whose address names a value no connection sets.
- Cloud connections (Bedrock, Azure, Vertex) are covered by tests of the requests they build, not
  yet by a session on a real account.

## Auditing a session tree

```bash
bun apps/api/scripts/session-audit.ts SESSION-ID --tree
bun apps/api/scripts/replay-context-policy.ts CHILD-SESSION-ID
```

The audit opens the database read-only, walks descendants, and reports transcript timing and tool
outcomes beside authoritative ledger totals. Ledger totals include auxiliary model calls without a
transcript message. A subscription value is an API-equivalent estimate, not a metered charge;
unpriced rows remain visible. Cumulative input across a tool loop is not its context-window size.

Replay uses the session's persisted delegation depth and the session agent's overhead. It states
that it reads all stored branches; it is a diagnostic replay, not a captured provider request. A
simulated checkpoint does not change the live session or prove a better task outcome.

Workspace instruction discovery reads Claude Code's instruction files (`CLAUDE.md`,
`.claude/CLAUDE.md`, `CLAUDE.local.md`, then `AGENTS.md`) from the filesystem root to the working
directory, and inside the checkout `.claude/rules/` and native Localix context at each level; a
subfolder's files and path-scoped rules join as the session's file tools reach them
(`context-on-demand.ts`). Directory scope and user precedence are explicit in the prompt. Project
`.claude/skills`, `.claude/commands` and portable `.agents/skills` use the existing skill scanner
and containment checks; personal `.agents` homes remain outside discovery.

## Related guides

- [Architecture](architecture.md)
- [Context checkpoints](../features/context-checkpoints.md)
- [Providers](../features/providers.md)

## Source of truth

- [Runtime interfaces](../../packages/agent/src/runtime/index.ts) ·
  [model session](../../packages/agent/src/runtime/model-session.ts) ·
  [engine descriptor](../../packages/agent/src/runtime/engine.ts)
- [Engine composition](../../packages/engine/src/engine.ts) ·
  [production assembly](../../apps/api/src/bootstrap/agent-engine.ts)
- [Agent loop](../../packages/engine-loop/src/loop.ts) ·
  [tool batch scheduler](../../packages/engine-loop/src/tools/schedule.ts) ·
  [one call](../../packages/engine-loop/src/tools/call.ts) ·
  [run handle and event buffer](../../packages/engine-loop/src/run-handle.ts)
- [Model session: streaming, retry, silence](../../packages/engine-models/src/session.ts) ·
  [request shaping](../../packages/engine-models/src/wire/prompt.ts) ·
  [provider state](../../packages/engine-models/src/wire/provider-state.ts) ·
  [provider SDKs and profiles](../../packages/engine-models/src/providers/connect.ts)
- [Catalog](../../packages/engine-models/src/catalog/catalog.ts) ·
  [normalization](../../packages/engine-models/src/catalog/normalize.ts) ·
  [models.dev source](../../packages/engine-models/src/catalog/source.ts)
- [Script sandbox](../../packages/engine-scripts/src/sandbox.ts)
- [Run execution](../../apps/api/src/features/chat/runtime/run/execute-run.ts) — one stage per file
  under [`run/stages/`](../../apps/api/src/features/chat/runtime/run/stages/frame.ts)
- [Run persistence](../../apps/api/src/features/chat/runtime/run/run-record.ts)
- [Chat history strategy](../../apps/api/src/features/chat/runtime/history/chat-strategy.ts)
- [Steering boundary](../../packages/agent/src/runtime/index.ts) ·
  [steering placement](../../packages/engine-loop/src/steering.test.ts)
- [Host steering wiring](../../apps/api/src/features/chat/runtime/run/steering-wiring.ts)
- [Queue entry kinds](../../apps/api/src/features/chat/runtime/wake-queue/kinds.ts) ·
  [what a running turn takes](../../apps/api/src/features/chat/runtime/wake-queue/steerable.ts)
- [Activation persistence](../../apps/api/src/features/chat/runtime/run/tool-deferral.ts)
- [Initial prompt roster](../../apps/api/src/features/chat/runtime/run/system-prompt-build.ts)
- [Activator input and partial name resolution](../../apps/api/src/features/agent-core/tools/activate-tools/activate-tools.ts)
- [Per-request context policy](../../apps/api/src/features/chat/runtime/history/request-transform.ts)
- [Retry and checkpoint recovery](../../apps/api/src/features/chat/runtime/run/recovery.ts)
- [Wire token estimate (media as flat allowances)](../../packages/agent/src/context/wire-media-tokens.test.ts)
  ·
  [per-model calibration learned from usage](../../packages/agent/src/context/token-calibration.ts)
- [Audit one stored session: tools, timing, usage, flags](../../apps/api/scripts/session-audit.ts) ·
  [replay its context policy](../../apps/api/scripts/replay-context-policy.ts)
- [Shared retry checkpoints](../../apps/api/src/features/chat/runtime/run/retry-checkpoint.ts)
- [Recovery regressions](../../apps/api/src/features/chat/runtime/run/transient-recovery.test.ts)
- [Architecture checks](../../scripts/check-architecture.mjs)
