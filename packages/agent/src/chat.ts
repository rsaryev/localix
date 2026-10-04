/**
 * Chat-level types and utilities for the @localixai/agent SDK.
 *
 * These types are the single source of truth for chat message representation
 * across all consumers — browser, server, edge. No framework dependencies.
 */

import type { AgentItem } from './agents/items'

// ---- Data parts ----------------------------------------------------------------

/** Generic key-value data part embedded in a message (usage stats, diagnostics, etc.). */
export interface DataPart<TType extends string = string, TData = unknown> {
  type: TType
  data: TData
  /** Transient parts are not persisted to storage. */
  transient?: boolean
}

// ---- Tool errors ----------------------------------------------------------------

export type ToolErrorKind =
  | 'aborted'
  | 'dismissed'
  | 'timeout'
  | 'validation'
  | 'not_found'
  | 'blocked'
  | 'provider'
  | 'execution'
  | (string & {})

export interface ToolErrorPayload {
  kind: ToolErrorKind
  message: string
  userMessage: string
  code?: string
  retryable?: boolean
  fatal?: boolean
  /**
   * The person-facing sentence for a refused call (`BeforeToolCallResult.personMessage`).
   * `message` stays the model's text; a card that showed it addressed the reader as "the user".
   */
  personMessage?: string
  /** Who refused a `blocked` call: a human decline renders neutral, a policy refusal does not. */
  refusal?: 'automatic' | 'human'
}

// ---- Message bindings ----------------------------------------------------------

/**
 * A user-supplied file attached to a chat message. Images and binary documents
 * (PDF) are carried as base64; text/code files are pre-extracted to `text` and
 * inlined into the prompt (model-agnostic, no vision required).
 *
 * Bytes are carried EITHER inline as base64 (`data`) OR by reference to a stored
 * file (`mediaId`). The SDK stays storage-agnostic: it never reads `mediaId` — a
 * host that uses file-backed attachments must rehydrate `data` from `mediaId`
 * before calling `toModelMessages` (parts with neither field are skipped). Old
 * messages predating file storage still carry inline `data` (back-compat).
 *
 * Persisted on the message and converted to model content parts by
 * `toModelMessages` — see the agents/chat module.
 *
 * Large non-image attachments may be SPILLED to disk by the host (written into
 * the session cwd) and replaced on the MODEL WIRE COPY ONLY by a `text` part
 * carrying `spilled: true` + a manifest (path + head preview) instead of the full
 * bytes — so the agent re-reads them lazily with its file tools rather than
 * re-billing the whole file every turn. The persisted/UI message keeps the full
 * content; spilling is a wire-only transform (like media rehydration). The SDK
 * itself never spills — that is host policy; it only honors the `spilled` flag
 * when building wire content (a spilled text part is emitted raw, not re-fenced).
 *
 * A `path` attachment is the copy-free desktop handoff for a file that already
 * exists on disk. It carries no bytes: the host keeps the absolute path in
 * persisted history and replaces it on the MODEL WIRE COPY ONLY with the same
 * spilled-text manifest described above. The SDK never reads the path itself.
 *
 * A `text` part carrying `contextRef: true` is a composer @-link expansion
 * (`@file:` / `@diff` / `@session:` …) attached by the host at send time: its
 * `text` is a pre-formatted, self-contained block (header + fenced content), so
 * — like `spilled` — it is emitted raw on the wire, and clients render it as a
 * compact pill instead of inline content.
 */
export type MessageAttachment =
  | {
      kind: 'path'
      path: string
      mediaType: string
      name: string
      size: number
    }
  | {
      kind: 'image'
      mediaType: string
      data?: string
      mediaId?: string
      name: string
      size: number
    }
  | {
      kind: 'video'
      mediaType: string
      data?: string
      mediaId?: string
      name: string
      size: number
    }
  | { kind: 'file'; mediaType: string; data?: string; mediaId?: string; name: string; size: number }
  | {
      kind: 'audio'
      mediaType: string
      data?: string
      mediaId?: string
      name: string
      size: number
      durationMs?: number
    }
  | {
      kind: 'text'
      name: string
      text: string
      size: number
      spilled?: boolean
      path?: string
      lineCount?: number
      contextRef?: boolean
    }

/** Where a binding entered the message. Kept transport/UI agnostic. */
export type MessageBindingSource =
  | 'upload'
  | 'mention'
  | 'drag'
  | 'active-tab'
  | 'slash'
  | 'plugin'
  | 'system'

export type MessageBindingStatus =
  | 'pending'
  | 'resolved'
  | 'empty'
  | 'unsupported'
  | 'out_of_scope'
  | 'denied'
  | 'timeout'
  | 'deadline_exceeded'
  | 'aborted'
  | 'error'

/** Provider-owned context materialized for the model, captured with provenance. */
export interface MessageBindingContribution {
  id: string
  providerId: string
  providerVersion: string
  scope: 'document' | 'project' | 'session' | 'global'
  kind: string
  content: string
  revision?: string
  sensitivity: 'public' | 'project' | 'sensitive' | 'forbidden'
}

/**
 * A file/resource/session/snippet/etc. linked to a message. `target.kind` is an
 * open vocabulary: the host owns built-ins, plugins own opaque URI schemes.
 */
export interface MessageContextBinding {
  kind: 'context'
  id: string
  source: MessageBindingSource
  /** Media/file evidence owned by this context snapshot. Kept nested so removing,
   *  retrying, or restoring the context remains one atomic operation. */
  assets?: MessageAttachment[]
  /**
   * The plugin whose open view this context came from. The turn that answers the message carries
   * that plugin's tools on the wire; a message sent after the view closed carries none. Minted by
   * the host from the tab's owner — a plugin's own draft cannot name another plugin.
   */
  plugin?: string
  target: {
    kind: string
    token: string
    label: string
    uri?: string
    attributes?: Record<string, string | number | boolean>
  }
  resolution: {
    status: MessageBindingStatus
    capturedAt?: string
    contributions: MessageBindingContribution[]
  }
}

/** Canonical model-facing envelope for one resolved context contribution. */
export function contextContributionModelText(contribution: MessageBindingContribution): string {
  const revision = contribution.revision ? ` revision=${contribution.revision}` : ''
  return `--- Context (${contribution.kind}; provider=${contribution.providerId}@${contribution.providerVersion}${revision}) ---\n${contribution.content}\n--- End context ---`
}

/** A one-shot or session-scoped capability invocation attached to the turn. */
export interface MessageInvocationBinding {
  kind: 'invocation'
  id: string
  source: 'slash' | 'plugin' | 'system'
  invocation: {
    kind: 'skill' | 'plugin-command' | 'workflow' | (string & {})
    name: string
    arguments?: string
    lifetime: 'turn' | 'session'
  }
  presentation: { label: string; token?: string }
  /** Resolved instruction is host-owned and never rendered as user text. */
  instruction?: string
}

/**
 * The one parent entity for everything attached/bound to a message.
 * Asset variants intentionally retain their compact historical wire shape;
 * context and invocation variants carry their own provenance and lifecycle.
 */
export type MessageBinding = MessageAttachment | MessageContextBinding | MessageInvocationBinding

export function isAssetBinding(binding: MessageBinding): binding is MessageAttachment {
  return binding.kind !== 'context' && binding.kind !== 'invocation'
}

export function assetBindings(
  bindings: readonly MessageBinding[] | undefined,
): MessageAttachment[] {
  return (bindings ?? []).flatMap((binding) => {
    if (isAssetBinding(binding)) return [binding]
    return binding.kind === 'context' ? (binding.assets ?? []) : []
  })
}

export * from './chat-context-bindings'

// ---- Chat message --------------------------------------------------------------

/**
 * A single message in a chat conversation.
 * Applications extend this type with presentation-only fields.
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Text content of the message. */
  content?: string
  /** Extended reasoning / chain-of-thought from the model. */
  reasoning?: string
  /**
   * Normalized item list — the canonical, ordered text/reasoning/tool items
   * (see `@localixai/agent/agents` items). The source of truth for both rendering
   * and LLM reconstruction.
   */
  items?: AgentItem[]
  /** Assets, linked context, and invocations bound to this message. */
  bindings?: MessageBinding[]
  /** Structured data attached to the message (usage stats, cache diagnostics, etc.). */
  dataParts?: DataPart[]
}

// ---- JSON utilities ------------------------------------------------------------

/**
 * Safely serialise an unknown value to a formatted JSON string.
 * Falls back to `String(value)` if JSON.stringify throws.
 */
export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

// ---- Message utilities ---------------------------------------------------------

/**
 * Returns true if `message` is the last assistant message in `messages`.
 * Useful for deciding whether to show streaming indicators or action buttons.
 */
export function isLastAssistantMessage(
  messages: Pick<ChatMessage, 'id' | 'role'>[],
  message: Pick<ChatMessage, 'id' | 'role'>,
): boolean {
  if (message.role !== 'assistant') return false
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].id === message.id
  }
  return false
}
