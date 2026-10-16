# Agent runtime boundary

The agent runtime converts a Localix session into one provider-backed run and returns Localix
events. Use this boundary to change providers or loop behavior without coupling the API to one
runtime library.

## Terminology

| Term            | Meaning                                                          | Boundary                                              |
| --------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Session         | Durable Localix messages, configuration, and execution metadata. | One session can contain multiple runs.                |
| Run             | One invocation of `AgentRuntime.run()` for a session.            | A retry starts another invocation.                    |
| Runtime port    | Provider-neutral interfaces in `packages/agent`.                 | The port contains no Pi types.                        |
| Runtime adapter | The implementation translating the port to a loop engine.        | Pi is the only production adapter.                    |
| Context policy  | A host callback applied before each model request.               | It changes model-facing messages, not the transcript. |
| Agent event     | A Localix lifecycle, message, tool, usage, or error event.       | Delivery uses a bounded adapter buffer.               |

## Ownership contract

| Layer          | Owns                                                                                          | Boundary                                                               |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Localix host   | Session state, modes, tools, permissions, context policy, persistence, and event publication. | It depends on the `AgentRuntime` interface, not Pi types.              |
| Runtime port   | `run()`, event iteration, terminal result, abort, and session disposal.                       | It models one run; retries can start another run.                      |
| Pi adapter     | Message conversion, tool bridging, credential access, stream mapping, and adapter buffering.  | Production uses this adapter; the port permits another implementation. |
| Pi loop engine | Provider requests, streamed model output, and loop-level tool dispatch.                       | Provider-specific events do not cross the adapter boundary.            |

## How it works

The composition root injects one runtime implementation into the chat service:

```text
session runner
  -> AgentRuntime.run(request, policy, hooks)
  -> Pi adapter
  -> Pi loop and provider
  -> ordered Localix event stream
  -> API handlers, transcript, and clients
```

### Run contract

| Surface          | Mechanism                                                                | Boundary                                                                   |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `events`         | An async iterable emits ordered Localix events while the run progresses. | Progress updates for one tool call can be coalesced under buffer pressure. |
| `result`         | A promise resolves to `completed`, `aborted`, or `failed`.               | A failed run can contain settled work from earlier turns.                  |
| `abort()`        | Stops the active adapter run through its abort signal.                   | The host still finalizes its durable run record.                           |
| `beforeToolCall` | The host can block or rewrite a tool call before dispatch.               | Permission policy remains a host responsibility.                           |
| `afterToolCall`  | The host receives the settled result after dispatch.                     | Publication and persistence remain host responsibilities.                  |
| `takeSteering`   | The adapter requests queued steering messages between loop steps.        | Delivery timing follows loop checkpoints.                                  |

The production API names the Pi adapter in exactly one expression: `createPiEngine(...)` in
`bootstrap/infra.ts`. The result is an `AgentEngine` — the agent loop, the buffered completion
factory, the image runtime, the OAuth runtime and the model catalog behind one adapter id — and
every phase after it is typed by the neutral ports. Test files are not exempt from the seam; a
behaviour that needs the real loop is asserted in the adapter package.

### How a run is assembled

`executeRun` (`chat/runtime/run/execute-run.ts`) runs the stages in order: admit, turn, view,
context, tools, prompt, intake, history, stream, then complete or fail. Each stage owns one concern;
the stream stage hands everything to `AgentRuntime.run()`.

| Layer           | What it carries                                                                                                                     | Owner                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Stable prompt   | Identity, core principles, runtime role, collaboration, execution discipline, workspace, conversation protocol, skills, formatting. | `agent-core/system-prompt.ts`; goldens in `agent-core/__prompts__/`.       |
| Runtime context | Date and model, project tree, participants, agent directory, jobs, loops, reactions, the current-turn line.                         | `agent-core/system-prompt-tail.ts`, sent as a changed-sections-only block. |
| History         | Participant view, turn contexts, media, checkpoint, budget admission.                                                               | `chat/runtime/history/chat-strategy.ts`.                                   |
| Tools           | Shape and policy resolution, deferral behind `activate_tools`, the wrapper chain.                                                   | `chat/runtime/run/tool-assembly.ts`.                                       |

Every agent in a conversation receives the same prompt for the same run shape. The only
seat-specific parts are the leadership block and session-topic control (`set_topic`), both given to
the participant with the highest leadership priority. The `chat` shape names no role, and a shipped
persona says who the agent is, not which seat it holds.

The host adds facts to a turn, not instructions: what happened, and where to find it. A reminder
says that a background job finished and where its output is stored, or that a language server still
reports errors. It does not restate a rule that the prompt already gives once. Add behaviour to the
prompt section that owns it, not to a situational reminder or a tool-result suffix.

Tool calls pass through plugin hooks, Claude Code hooks, the timeout promoter and the stuck-run
breaker (`chat/runtime/run/tool-wrapper-chain.ts`). The breaker appends nothing before a limit. It
ends a run when one call fails the same way four times, when six calls fail with no success between,
or when one call is issued eight times in a row. A tool that declares `idempotentHint: false` is
compared by its answers as well.

### Steering and tool checkpoints

The adapter passes `SteeringBoundary` to `takeSteering`: the completed turn index and, only after a
successful turn with tool results, the completed tool-turn index. The host waits for that turn to
reach its transcript checkpoint before admitting a queued message into a new assistant row. A
checkpoint wait expires after two seconds by default; timeout or abort leaves the queue untouched.

User messages are filtered by the current speaker's address. A delegator's message can amend a
running child's assignment. Chat runs also opt into one eligible child report per completed tool
turn, addressed to the running delegator; only solo chats accept an unaddressed report. Reports with
bindings, execution overrides, or an independent completion waiter remain on the standalone run
path. Other machine wakes retain their own turns. `LOCALIX_MID_RUN_INTERJECT=0` disables this
mid-run queue consumption.

### Tool deferral

Plugin and MCP tool schemas are the half of the tool list that grows without bound, so they are
deferred: the model sees `activate_tools` with a compact catalog instead, and activates by exact
name.

| Surface            | Mechanism                                                                                                              | Boundary                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Core toolkit       | Assembled core tools remain on the wire after policy and run-shape filtering.                                          | Run shape can still exclude a tool that the host cannot support, such as human-only UI in automation. |
| Deferred tools     | `activate_tools` advertises them; the adapter appends an activated schema before the next model turn.                  | A deferred implementation stays dispatchable, so deferral is a wire decision only.                    |
| Session activation | An activated name is remembered on the session and promoted onto the wire at the start of every later run.             | Bounded per session; the oldest activation is released and the model is told which.                   |
| Surface tools      | A plugin whose tab the person's latest message links, or whose wake the turn answers, brings every tool it registered. | Per turn and never stored; appended after the session's activations, sorted by name.                  |
| The loader itself  | Stays present while any external tool exists, with an empty-catalog description once all are active.                   | Names resolve through the run's own registry, never through the remembered list.                      |

Activation persists on the session rather than being inferred from transcript history. Remembered
names preserve activation order; a later run promotes only names still available in its authorized
registry. Context checkpoints can remove an old activation call without removing the remembered
name. Changes to capabilities, plugin availability, or the activation budget can change the next
run's tool list.

The activator accepts at most eight exact names per call. Unknown names are reported without
preventing known names from activating. Persistence is best-effort: a failed storage write leaves
activation available in the current run, but a later run may need to activate again. Releasing an
old name from the remembered set affects later assembly; the Pi adapter only appends revealed
schemas and does not remove them from a run already in progress.

The prompt is assembled once per run from its initial wire roster, including remembered and surface
promotions. Mid-run activation reveals schemas without rebuilding that prompt. The next run builds
its own roster again. Stable ordering can help prompt-cache reuse; it does not guarantee an
unchanged prefix or a fixed token cost or price for activation.

Surface tools follow the current message context and stay outside the session's remembered
activation set. The host stamps a plugin tab binding with `MessageContextBinding.plugin` and a
plugin wake with `plugins`. `apps/api/src/features/chat/runtime/run/surface-tools.ts` reads those
owners and promotes their registered tools for the relevant turn:

- **Tabs come from the person's latest message**, not from the row the run answers. A sub-agent's
  report or a job's exit wakes the session with a row that links no tabs. Reading only that row
  would switch the tool list off and on between each report and reply, and every switch is a full
  cache miss. Closing a tab, or removing its chip, takes effect at the person's next message.
- **A wake's plugin counts for the turn that answers it**, and not after.
- **Names are resolved on the server**, from what each plugin registered. A tab cannot ask for a
  tool its plugin does not own, and a renamed tool arrives under its new name.
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
| Pre-stream retry           | The Pi adapter passes its retry settings to the loop engine before a stream opens.                             | Production configures two retries with a 60-second maximum delay.                 |
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

Messages are stored as the durable session transcript. A separate run row records the active adapter
invocation and its terminal status so startup can reclassify a run interrupted by process death.
Streaming events are published to clients; they are not maintained as a second durable event
journal.

## Configuration

Runtime settings are assembled in the API bootstrap, not in user settings.

| Setting             | Production value      | Purpose                                              |
| ------------------- | --------------------- | ---------------------------------------------------- |
| `maxRetries`        | `2`                   | Pre-stream retry count passed to the Pi loop engine. |
| `maxRetryDelayMs`   | `60_000`              | Upper retry delay passed to the Pi loop engine.      |
| `maxBufferedEvents` | Adapter default `256` | Capacity of the Localix event buffer.                |

Context-policy round trips preserve prompt-cache anchors on user, assistant, and tool messages. At
the client/service boundary, failed-retry recovery snapshots cannot overwrite newer stream state.
Authoritative message updates replace corrected tool payloads even when their terminal status is
unchanged.

Cancellation releases producers blocked by a full event queue; an attached consumer can drain
already-buffered events, but cancellation does not promise delivery of pending events. Thrown
middleware failures retain messages through the last fully settled turn in the runtime result. The
stream silence watchdog interrupts a pending iterator on caller cancellation and releases the
provider connection when a consumer stops iteration early.

Post-tool processing keeps the stored text and content parts aligned with the effective Pi result,
so shortened output cannot be replaced by stale pre-hook parts. Human-in-loop requests inherit
tool-run cancellation, including when a tool supplies an additional request signal. Without an
explicit invocation trigger ID, binding materialization selects the last non-internal, non-UI-only
user message; synthetic reminders do not consume its one-shot instruction.

The agent loop and buffered completions share transport retry settings. A configured `timeoutMs`
also reaches buffered completions, such as title generation; production bootstrap currently leaves
that setting unset, so provider transport defaults apply. The loop's stream-idle watchdog is
separate from this transport timeout.

## Limits

- Pi is the only production `AgentRuntime` adapter in this repository. The neutral port is an
  architectural seam, not evidence of multiple installed loop engines.
- Event buffering is bounded. Repeated progress updates coalesce, and a producer that fills the
  buffer before consumption can displace the oldest buffered event.
- Provider refusal headers are captured only on transports that expose the response before raising
  an error. The adapter cannot recover headers it never receives.
- Pre-stream retries, mid-stream retries, and checkpoint reruns have separate gates and counters.
  They do not form one shared attempt budget.
- Context pruning and checkpoints preserve the durable transcript but can remove detail from the
  next model request.
- Adapter neutrality is checked through source-import rules and TypeScript contracts. It is not a
  runtime isolation boundary.

## Auditing a session tree

```bash
bun apps/api/scripts/session-audit.ts SESSION-ID --tree
bun apps/api/scripts/replay-context-policy.ts CHILD-SESSION-ID
```

The audit opens the database read-only, walks descendants, and reports transcript timing and tool
outcomes beside authoritative ledger totals. Ledger totals include auxiliary model calls without a
transcript message. A subscription value is an API-equivalent estimate, not a metered charge;
unpriced rows remain visible. Cumulative input across a tool loop is not its context-window size.

Replay uses the session's persisted delegation depth and the selected participant's overhead. It
states that it reads all stored branches; it is a diagnostic replay, not a captured provider
request. A simulated checkpoint does not change the live session or prove a better task outcome.

Workspace instruction discovery includes bounded `AGENTS.md` files from the checkout root to the
working directory, followed by native Localix context at each level. Directory scope and user
precedence are explicit in the prompt. Portable project `.agents/skills` use the existing skill
scanner and containment checks. Personal foreign agent homes remain outside discovery.

## Related guides

- [Architecture](architecture.md)
- [Context checkpoints](../features/context-checkpoints.md)
- [Providers](../features/providers.md)

## Source of truth

- [Runtime interfaces](../../packages/agent/src/runtime/index.ts)
- [Pi adapter](../../packages/agent-runtime-pi/src/runtime.ts)
- [Per-run tool assembly](../../packages/agent-runtime-pi/src/run-tools.ts)
- [Event mapping](../../packages/agent-runtime-pi/src/event-codec.ts)
- [Production runtime assembly](../../apps/api/src/bootstrap/infra.ts)
- [Run execution](../../apps/api/src/features/chat/runtime/run/execute-run.ts) — one stage per file
  under [`run/stages/`](../../apps/api/src/features/chat/runtime/run/stages/frame.ts)
- [Run persistence](../../apps/api/src/features/chat/runtime/run/run-record.ts)
- [Chat history strategy](../../apps/api/src/features/chat/runtime/history/chat-strategy.ts)
- [Engine descriptor (port)](../../packages/agent/src/runtime/engine.ts) ·
  [Pi engine](../../packages/agent-runtime-pi/src/engine.ts)
- [Cache anchor → `cache_control` (pi adapter)](../../packages/agent-runtime-pi/src/cache-anchor.test.ts)
- [Prompt-cache TTL from the host's idle gap](../../packages/agent-runtime-pi/src/cache-retention.ts)
- [Steering boundary](../../packages/agent/src/runtime/index.ts)
- [Host checkpoint gate](../../apps/api/src/features/chat/runtime/run/tool-checkpoint-gate.ts)
- [Addressed report eligibility](../../apps/api/src/features/chat/runtime/wake-queue/steering.ts)
- [Activation persistence](../../apps/api/src/features/chat/runtime/run/tool-deferral.ts)
- [Initial prompt roster](../../apps/api/src/features/chat/runtime/run/system-prompt-build.ts)
- [Activator input and partial name resolution](../../apps/api/src/features/agent-core/tools/activate-tools/activate-tools.ts)
- [Steering placement](../../packages/agent-runtime-pi/src/steering.test.ts)
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
