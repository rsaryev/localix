# Context system

The context system records what a user attached to a turn and what tools consulted for an answer. It
gives model input and transcript provenance separate contracts so neither can silently grant the
other authority.

**Boundary:** User bindings contain captured model evidence. Tool sources are compact presentation
metadata beside tool evidence; they are not another model-context channel.

## Terminology

| Term           | Meaning                                                               | Boundary                                      |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Binding        | A persisted asset, context, or invocation associated with a message   | Each variant has different authority          |
| Context target | The user-visible kind, token, label, URI, and attributes of a binding | Its label is presentation, not model evidence |
| Contribution   | Admitted provider or host content captured for model history          | Packing can omit source content               |
| Source         | Compact provenance attached to a tool-backed assistant item           | It does not duplicate the tool's evidence     |
| Discovered     | A locator found without its content entering tool evidence            | It is excluded from the answer Sources action |
| Consulted      | Bounded content that entered the tool result                          | It says nothing about user selection          |
| Cited          | A source explicitly identified as a citation by an upstream provider  | It remains compact presentation metadata      |
| Absence note   | The one-line reason a binding produced no content                     | It is model-visible text, never content       |

## What you can do

| Direction                | Canonical contract                                          | Capture point                                 | Boundary or failure mode                                           |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| User to model            | `MessageBinding`, especially `MessageContextBinding`        | Chat service accepts the turn                 | A denied or unsupported binding contributes no hidden body         |
| Tool to transcript       | `AgentToolResult.sources` becoming `ToolBackedItem.sources` | Tool result coercion and run-item persistence | A source record does not duplicate the tool's model-facing content |
| Tab to user binding      | `MessageContextBindingDraft`                                | Composer send merge                           | Ambient refs yield to manual refs and the wire cap                 |
| Provider to user binding | `ContextContribution`                                       | Fabric resolution during message acceptance   | Provider output crosses host admission before persistence          |
| Source to UI action      | `AgentSource.uri`                                           | Message Sources presentation                  | Unknown non-HTTP URIs render without a navigation action           |

The invariant is one persisted message payload. Context bindings and tool-backed items live on that
payload; no second context capture or source-registry field is stored beside it.

## How it works

### Capture user-selected context

```text
typed, pinned, dragged, or ambient binding draft
  → composer precedence and size preflight
  → API binding validation
  → resolveMessageBindings at turn acceptance
  → Context Fabric resolution in the session's scope and workspace
  → secret, scope, containment and exclusion admission
  → resolved MessageContextBinding on the user message
  → wire text assets from admitted contributions (history media stage)
```

`resolveMessageBindings` runs before the busy-session branch. A queued user turn therefore carries
the already resolved binding snapshot instead of re-reading a resource when the queue drains.

Every binding kind resolves through one path. A binding target is read as a Fabric reference with
the binding's own id (`captureContextBindings`). Core's host-reference resolver serves file, folder,
snippet, session, project, message, terminal and call targets through the existing expanders. A file
contribution carries `source.path`, so the user's and project's `contextExclusions` apply to a
linked file. Plugin resolvers serve their schemes; the generic resource bridge serves any scheme
without one.

A binding that yields no content still reaches the model as an absence note, such as "not included:
the context policy withheld it". A policy denial states only that the content was withheld. A full
turn budget says so, which distinguishes it from a denial.

`contextBindingsToModelAssets` converts only persisted contributions into `contextRef: true` text
assets on the model-wire copy. The transcript binding keeps the target label, resolution status,
capture time, and contribution provenance. The full persistence, edit, fork, retry, and regenerate
rules belong to [Message bindings](message-bindings.md).

Open-tab ranking and live plugin state belong to [Active-tab context](active-tab-context.md). That
page owns the ambient five-facet limit and manual-over-ambient send order.

### Persist tool provenance

```text
built-in, plugin, or MCP tool result
  → coerceToolResult
  → normalizeAgentSources
  → tool_execution_end
  → ToolBackedItem.sources
  → assistant message payload
  → MessageSources action
  → selected message's Activity inspector
```

`normalizeAgentSources` validates strings and scalar metadata, bounds the result, and merges
repeated `kind + uri` observations. `mergeSource` retains the strongest role: `cited`, then
`consulted`, then `discovered`. An available observation upgrades a failed one.

The tool's `content` remains the evidence replayed to the model. `AgentSource` carries a title, URI,
role, status, and optional short display metadata. The run's tool-end handler copies those records
onto the tool-backed item that is persisted with the assistant message.

### Present answer sources

`answerSourcesOfMessage` derives sources from one assistant message. It includes only available
`consulted` and `cited` records; discovered locators and failed reads remain on their tool items.

The Sources action opens the selected message in the Activity inspector and scrolls to its Sources
section. HTTP and HTTPS URIs open externally. Registered application URIs navigate through the UI
navigation registry. Unknown schemes remain inert.

`collectSessionSources` can derive a session-wide first-seen registry from messages already in
memory. The current Sources action does not use that aggregate; it stays scoped to the selected
message.

## Configuration

These are enforced bounds, not user-facing settings.

| Control                            |            Value | Boundary                                              |
| ---------------------------------- | ---------------: | ----------------------------------------------------- |
| Total bindings per message         |               20 | API schema; includes assets, context, and invocations |
| Binding content bytes              |           25 MiB | Counts carried bodies, not JSON metadata or paths     |
| Linked context per sent message    |            4 MiB | Every binding of one turn; later ones get a note      |
| Authoritative chat Fabric deadline |         5,000 ms | One accepted turn                                     |
| `MAX_AGENT_SOURCES`                |       32 records | Maximum normalized sources on one tool result         |
| Source inputs inspected            |      256 records | Allows bounded duplicate role upgrades                |
| Source snippet                     | 1,000 characters | Presentation metadata only                            |
| Source metadata entries            |               12 | Values are strings, finite numbers, or booleans       |

## Limits

- A context binding snapshot is bounded and can be denied, empty, unsupported, or timed out.
  Providers and live-snippet producers can also return bounded or truncated content. Persistence
  guarantees replay identity, not complete source content.
- A binding past the 4 MiB turn budget is dropped whole, not truncated. The turn names it with the
  budget as the reason.
- A user binding does not prove a tool consulted that resource later. A tool source does not prove
  the user selected or authorized the corresponding resource.
- `AgentSource` bodies are intentionally absent. Persisting only a snippet and URI means provenance
  cannot reconstruct the tool's complete evidence packet.
- The current answer action excludes discovered and failed records and shows one message. The
  session-wide derived collector has no dedicated presentation in this path.
- Source-role merging is monotonic within a dedupe key. A later weaker observation cannot downgrade
  a source from cited or consulted.
- Unknown application URI schemes remain visible but inert. A UI anchor or built-in navigation
  parser must own the scheme before the row can open it.
- A context checkpoint can reduce the later model-facing transcript. It does not mutate the stored
  binding or tool-source records.

## Related guides

- [Message bindings](message-bindings.md)
- [Active-tab context](active-tab-context.md)
- [Context Fabric and Edit Prediction](context-and-edit-prediction-architecture.md)
- [Research context](research-context.md)
- [Context checkpoints](../../features/context-checkpoints.md)

## Source of truth

- [Parent message and source types](../../../packages/agent/src/chat.ts) ·
  [agent sources](../../../packages/agent/src/agents/sources.ts)
- [API validation](../../../apps/api/src/features/chat/contracts/messages.ts)
- [Binding resolution and model assets](../../../apps/api/src/features/chat/service/message-bindings.ts)
  · [Fabric capture](../../../apps/api/src/features/context-fabric/binding-capture.ts) ·
  [host-reference resolver](../../../apps/api/src/features/context-fabric/host-ref-resolver.ts)
- [Acceptance and queue boundary](../../../apps/api/src/features/chat/service/turn-entry.ts)
- [Wire materialization (media stage)](../../../apps/api/src/features/chat/runtime/history/stages/media.ts)
- [Tool-result normalization](../../../packages/agent/src/agents/error-classification.ts)
- [Tool item persistence flow](../../../apps/api/src/features/chat/runtime/run/event-handlers-tools.ts)
  · [item accumulator](../../../apps/api/src/features/chat/runtime/items.ts)
- [Derived source collectors](../../../apps/ui/src/features/chat/model/sessionSources.ts)
- [Message Sources action](../../../apps/ui/src/features/chat/ui/MessageSources.tsx) ·
  [Activity inspector](../../../apps/ui/src/features/inspector/ui/MessageReplayTab.tsx)
- [Source navigation](../../../apps/ui/src/features/chat/ui/sources/SourceRow.tsx)
