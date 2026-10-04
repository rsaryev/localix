# Message bindings

Message bindings are the persisted assets, captured context, and invocation metadata attached to a
chat message. Use this page when changing message transport, capture, replay, editing, model
history, plugin hooks, or search indexing.

## Terminology

| Term               | Meaning                                                                 | Boundary                                                                |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Binding            | One `MessageBinding` stored beside a message's visible content          | The parent union contains assets, context, and invocations              |
| Asset binding      | A `path`, `image`, `video`, `file`, `audio`, or `text` payload          | Only context and invocation bindings carry a binding `id`               |
| Context binding    | A target plus its capture status, timestamp, and admitted contributions | Target kinds and resource URI schemes are open vocabulary               |
| Invocation binding | Presentation metadata and a resolved skill, command, or workflow prompt | Instructions are model-only and active-turn materialization is separate |
| Contribution       | Provider-attributed content admitted for model history                  | A denied, unsupported, empty, or failed capture contributes no body     |
| Draft              | A pre-persistence asset or unresolved context target from the composer  | The API accepts only the complete persisted `MessageBinding` shape      |

## What you can do

| Operation                    | Mechanism                                                                    | Boundary                                                           |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Attach media or text         | Asset variants travel in the message's single `bindings` array               | A `path` binding carries a host path, not inline file bytes        |
| Link current context         | The chat service resolves context targets before accepting the user turn     | Capture can finish without an admitted contribution                |
| Invoke a skill or command    | One visible user message carries one model-only invocation instruction       | Editing that message removes every invocation binding              |
| Preserve replay identity     | The resolved binding array is stored in `agent_messages.payload_json`        | Mutable context is not fetched again during replay or regeneration |
| Add assistant deliverables   | Native plugin hooks append validated bindings before the final message write | Plugin output is capped and malformed entries are dropped          |
| Exchange channel attachments | Channel input and output use `MessageAttachment[]`                           | Channel contracts do not carry context or invocation bindings      |

The [context system](context-system.md) owns Fabric capture, absence notes, admission, and tool
source provenance. [Active-tab context](active-tab-context.md) owns ambient tab ranking and the
manual-over-ambient composer merge.

## How it works

### Acceptance and capture

The composer merges uploads, typed references, pinned or dragged targets, and ambient tab targets.
It sends one `bindings` array with the visible prompt. The chat service adds invocation bindings
when it resolves a slash command into a skill, plugin command, or workflow.

The API validates the complete binding shape, the count, and model-bearing payload bytes.
`resolveMessageBindings` then processes every context binding before the message is persisted. A
Fabric denial is final; other unresolved Fabric outcomes can use the native ref expander. Native
expansions containing a secret-shaped value are recorded as `denied` with no contribution.

The accepted user message stores the resolved snapshot. Busy-session queueing receives that same
snapshot, so draining the queue does not re-read files, messages, terminals, or provider resources.

### Model history and presentation

`contextBindingsToModelAssets` converts admitted contributions into model-only `text` assets with
provider and revision provenance. Asset bindings are rehydrated or spilled on the model-wire copy;
the persisted message remains unchanged. The spill contract belongs to
[attachment spill](attachment-spill.md).

The history strategy's media stage (`history/stages/media.ts`) materializes invocation instructions
only from the active invocation message. The transcript renders context targets and invocation
presentation as compact pills; contribution bodies and invocation instructions are not rendered as
user text.

### Branching and storage

Regeneration reuses the stored user message and its bindings. Editing a user message forks a new
branch, retains its asset and resolved context bindings, and drops invocation bindings because the
new text can invalidate their arguments.

SQLite stores the whole message in `agent_messages.payload_json`. The generated `search_text` column
extracts only `$.content`, so full-text search excludes binding JSON, base64 data, captured
contributions, and invocation instructions.

## Configuration

These are enforced contracts, not user settings.

| Control                                |        Value | Enforced by                                                                         |
| -------------------------------------- | -----------: | ----------------------------------------------------------------------------------- |
| Bindings on one user send              |           20 | [Message request schema](../../../apps/api/src/features/chat/contracts/messages.ts) |
| Model-bearing binding content per send |       25 MiB | UTF-8 bytes of asset bodies, contribution bodies, and invocation instructions       |
| Plugin-added assistant bindings        |            8 | [Assistant hook runner](../../../apps/api/src/features/plugins/hooks-messages.ts)   |
| Plugin-added payload per binding       |        8 MiB | Malformed or oversized hook output is dropped                                       |
| Live plugin facets per mounted tab     |            5 | [Plugin UI contribution contract](../../../packages/plugin-sdk/src/ui/contrib.ts)   |
| Live plugin snippet content            | 40,000 chars | Truncated by the plugin UI factory and untrusted-publication normalizer             |

The 25 MiB request guard counts content, not the serialized metadata envelope. A `path` binding
counts toward the 20-binding limit but contributes zero content bytes to this guard.

## Limits

- `MessageInvocationBinding` declares `turn` and `session` lifetimes, but the current media stage
  injects invocations only from the active user message. Session-scoped replay is not implemented.
- Accepted context bindings require non-empty `id`, target token, and label fields. UI drafts for
  structured message or snippet targets can begin without a typed token; the composer synthesizes a
  stable token before sending.
- Persistence preserves the captured result, including failure status. It does not make an empty,
  unsupported, denied, timed-out, or errored binding useful to the model.
- Asset storage and model transport differ. Inline media can become a stored `mediaId`, and large
  non-image content can become a spill manifest on the model-wire copy.
- Assistant plugin hooks can add all parent binding variants, but external channel contracts accept
  and return assets only.
- Full-text search cannot locate labels, URI attributes, captured contribution text, or hidden
  invocation instructions because only visible message content enters `search_text`.
- Binding provenance is data, not instruction authority. Captured files, resources, plugin output,
  and external content do not override system or user instructions.

## Related guides

- [Context system](context-system.md)
- [Active-tab context](active-tab-context.md)
- [Attachment spill](attachment-spill.md)
- [Context checkpoints](../../features/context-checkpoints.md)
- [Plugin authoring](../../extending/plugins.md)

## Source of truth

- [Parent binding types](../../../packages/agent/src/chat.ts)
- [API shapes and request guards](../../../apps/api/src/features/chat/contracts/messages.ts)
- [Context resolution and model assets](../../../apps/api/src/features/chat/service/message-bindings.ts)
- [Acceptance before queueing](../../../apps/api/src/features/chat/service/turn-entry.ts)
- [Wire materialization (media stage)](../../../apps/api/src/features/chat/runtime/history/stages/media.ts)
- [Edit and regeneration behavior](../../../apps/api/src/features/chat/service/branching-ops.ts)
- [Slash invocation persistence](../../../apps/api/src/features/chat/service/run-macro.ts)
- [Composer merge](../../../apps/ui/src/features/chat/model/sendRefs.ts)
- [Drag transport](../../../packages/plugin-sdk/src/ui/message-binding-drag.ts)
- [Plugin assistant validation](../../../apps/api/src/features/plugins/hooks-messages.ts)
- [Storage and search](../../../apps/api/migrations/20260601T000000_init_schema.ts)
