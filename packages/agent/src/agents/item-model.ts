import type { MessageAttachment, ToolErrorPayload } from '..'

/** An image a tool returned — the same shape as an image a user attached. */
export type ToolImageAttachment = Extract<MessageAttachment, { kind: 'image' }>
import type { AgentToolPresentation, ToolActionDescriptor, ToolGateProvenance } from './types'
import type { AgentSource } from './sources'

/**
 * Normalized **Item** model — the single language for "what an agent did", shared by
 * our own agent loop, external CLI adapters (Claude Code / Codex), and the UI renderer.
 *
 * Design: the unit of agent work is a typed, identified, *stateful* item rather than
 * a fire-and-forget event. An ordered `AgentItem[]` is the SINGLE source of truth for
 * an assistant message. It replaces the old `contentBlocks` (ordering) + `toolParts`
 * (data) split. Items fall into two families:
 *
 *  - **narrative** (`text` / `reasoning`) — what the model wrote.
 *  - **tool-backed** (`command` / `file_change` / `mcp_call` / `tool_call`) — every
 *    one is a tool call under the hood, so they share `ToolBackedBase` (toolCallId,
 *    name, input, model-facing resultText, error) for LLM reconstruction, plus
 *    type-specific rich fields for display. A small set is SPECIALIZED for rich
 *    rendering; everything else (built-ins, mini app tools, CLI dynamic tools) is the
 *    GENERIC `tool_call`, which is the escape hatch for unspecialized calls.
 *
 * Items belong to a TURN (`turnIndex`) so the LLM wire can be rebuilt in causal
 * think→call→result order; a TURN also carries cross-item summaries (usage,
 * aggregated diff, stop reason).
 *
 * Events are item lifecycle (`item.started` → `item.delta`* → `item.updated`* →
 * `item.completed`), folded into item state by `applyItemEvent`. The reducer is pure
 * and isomorphic, so backend, adapters, and UI all reduce identically.
 *
 * This layer is provider/tool-AGNOSTIC: it never hardcodes tool names. The item's
 * PRODUCER picks the type (the tool that runs a command emits a `command` item; a CLI
 * adapter maps its own stream); a name→type helper, if useful, lives in the app layer
 * next to the tool registry.
 */

// ---- Item status ----------------------------------------------------------------

/** Lifecycle shared by every item. `aborted` = stopped by user / kill. */
export type AgentItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted'

interface AgentItemBase {
  /** Stable id; deltas/updates target the item by this id. */
  id: string
  status: AgentItemStatus
  /**
   * Which agentic turn produced this item. The LLM wire is rebuilt per turn
   * (one assistant + tool message pair each) to preserve causal order. Optional:
   * single-turn producers (and most CLI adapters) may leave it undefined.
   */
  turnIndex?: number
  /** Original position inside the provider assistant content array. */
  contentIndex?: number
  /** Provider identity required to replay opaque signatures only to their origin model. */
  api?: string
  provider?: string
  model?: string
  /** The provider-native reasoning level the item's response was bound to; see `AssistantMessage`. */
  providerThinkingLevel?: string
  /** Unix ms; set when the item starts / completes. Drives duration display. */
  startedAt?: number
  completedAt?: number
}

/**
 * Shared base for items that ARE tool calls (command / file_change / mcp_call /
 * tool_call). Carries the wire linkage so an item list reconstructs into LLM
 * tool_call + tool_result pairs without a separate `toolParts` array.
 */
/**
 * Lifecycle of a job that outlives the tool call that started it. `lost` means the process
 * running it died (a restart), so nothing knows how it ended — without it, a job's item kept the
 * last `running` it was written with and every surface showed it as live forever.
 */
export type CommandJobStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timeout' | 'lost'

interface ToolBackedBase extends AgentItemBase {
  /** Matches the wire `tool_call` id. */
  toolCallId: string
  /** The tool's own name (`bash`, a mini app tool), even when the model called its `modelName`. */
  name: string
  /** Parsed tool arguments from the model. */
  input?: unknown
  /** Opaque provider reasoning context attached to this exact tool-call part. */
  thoughtSignature?: string
  /**
   * Concise model-facing result string (the tool's `content`). This — not the rich
   * display fields — is what is replayed to the model on later turns, so heavy
   * UI-only payloads never re-enter the prompt. Falls back to nothing when absent.
   */
  resultText?: string
  /** Resource provenance from the tool result; display-only, never model replay. */
  sources?: AgentSource[]
  /**
   * Images the tool RETURNED, stored by the host as media (`mediaId`, never inline base64).
   * Without it the picture lived only in its own run: the next turn replayed `[image]`, the
   * model said it saw nothing, and the card had nothing to show. The host rehydrates `data` on
   * the wire copy when the model reads images; the card renders them.
   */
  attachments?: ToolImageAttachment[]
  /**
   * The call handed off to a job that outlives it: the tool result is already final while
   * the work continues, and the job's own lifecycle is tracked in {@link jobStatus}.
   *
   * On the BASE rather than on `command`, because outliving your own tool call is not a
   * property of shell commands. A background data stream, and a call promoted to the
   * background because it outran its budget, are the same thing from a reader's side — and
   * while these lived only on the command item, any other tool's job was invisible to every
   * surface that renders one.
   */
  isBackground?: boolean
  /**
   * The job's lifecycle, past the tool call's own. Present exactly when there is a job, so it
   * doubles as the test for one.
   */
  jobStatus?: CommandJobStatus
  errorText?: string
  error?: ToolErrorPayload
  /**
   * Live-state supersede key from the tool result (e.g. `preview`): older same-key
   * results are collapsed in the model context, keeping only the latest. Persisted
   * on the item so the collapse survives a DB rehydrate ACROSS turns (otherwise a
   * preview-heavy session re-feeds every stale snapshot/screenshot each turn).
   */
  supersedeKey?: string
  /**
   * Permission-gate provenance when the call was allowed by something worth
   * explaining (user approval, session-wide grant, an explicit allow rule).
   * Display-only — never replayed to the model. Absent for default allows.
   */
  gate?: ToolGateProvenance
  /** Tool-declared presentation boundary for live or interactive surfaces. */
  standalone?: boolean
  /** Descriptor-owned transcript treatment persisted onto the item. */
  presentation?: AgentToolPresentation
  /** Live, serializable actions; executable callbacks remain in the host registry. */
  actions?: ToolActionDescriptor[]
}

// ---- Narrative items -------------------------------------------------------------

/** Assistant narration text (streams via `item.delta`). */
export interface TextItem extends AgentItemBase {
  type: 'text'
  text: string
  textSignature?: string
}

/** Extended-thinking / reasoning text. */
export interface ReasoningItem extends AgentItemBase {
  type: 'reasoning'
  text: string
  thinkingSignature?: string
  redacted?: boolean
}

// ---- Tool-backed items (rich, generically rendered) ------------------------------

/** Shell command execution (our `bash`, codex `CommandExecution`, claude `Bash`). */
export interface CommandItem extends ToolBackedBase {
  type: 'command'
  command: string
  cwd?: string
  /** Aggregated stdout+stderr tail (streams via `item.delta` on field `output`). */
  output?: string
  exitCode?: number
  durationMs?: number
  /** When the job runs in a PTY pane, the backend terminal id the UI can attach to. */
  terminalId?: string
}

export type FileChangeKind = 'add' | 'modify' | 'delete' | 'rename'

/** One file touched by a file_change item. */
export interface FileChange {
  path: string
  kind: FileChangeKind
  /** Unified diff for this file, when available. */
  diff?: string
  /** This file could NOT be applied (e.g. a partial apply_patch) — rendered as a
   *  failed row, not a successful change. */
  failed?: boolean
  /** Why the file failed to apply — shown on the failed row. */
  failReason?: string
}

/** File edits / patches (our `write`/`edit`, historical `apply_patch`, codex `FileChange`). */
export interface FileChangeItem extends ToolBackedBase {
  type: 'file_change'
  changes: FileChange[]
}

/** An MCP tool call (rendered with server/tool provenance). */
export interface McpCallItem extends ToolBackedBase {
  type: 'mcp_call'
  server: string
  tool: string
  /** Rich result payload for display (model-facing summary stays in `resultText`). */
  result?: unknown
  durationMs?: number
}

/**
 * Generic tool call — the escape hatch for every tool we don't specialize
 * (built-ins like read/search/delegate, ALL mini app tools, CLI dynamic tools).
 */
export interface ToolCallItem extends ToolBackedBase {
  type: 'tool_call'
  /** Rich UI detail (diffs, metadata). Not replayed to the model. */
  output?: unknown
  /** Verb shown while running (e.g. 'Reading'). */
  activeVerb: string
}

export type ToolBackedItem = CommandItem | FileChangeItem | McpCallItem | ToolCallItem
export type NarrativeItem = TextItem | ReasoningItem
export type AgentItem = NarrativeItem | ToolBackedItem
export type AgentItemType = AgentItem['type']

const TOOL_BACKED_TYPES: ReadonlySet<AgentItemType> = new Set([
  'command',
  'file_change',
  'mcp_call',
  'tool_call',
])
const NARRATIVE_TYPES: ReadonlySet<AgentItemType> = new Set(['text', 'reasoning'])

/** Narrow an item to the tool-backed family (carries toolCallId/name/resultText). */
export function isToolBackedItem(item: AgentItem): item is ToolBackedItem {
  return TOOL_BACKED_TYPES.has(item.type)
}

/** Narrow an item to the narrative family (carries a `text` field). */
export function isNarrativeItem(item: AgentItem): item is NarrativeItem {
  return NARRATIVE_TYPES.has(item.type)
}

// Per-type guards — the canonical way to narrow an AgentItem. Use these instead
// of `item.type === '…'` checks scattered across consumers.
export const isTextItem = (item: AgentItem): item is TextItem => item.type === 'text'
export const isReasoningItem = (item: AgentItem): item is ReasoningItem => item.type === 'reasoning'
export const isCommandItem = (item: AgentItem): item is CommandItem => item.type === 'command'
export const isFileChangeItem = (item: AgentItem): item is FileChangeItem =>
  item.type === 'file_change'
export const isMcpCallItem = (item: AgentItem): item is McpCallItem => item.type === 'mcp_call'
export const isToolCallItem = (item: AgentItem): item is ToolCallItem => item.type === 'tool_call'

/** True while an item is still in flight (pending or running). */
export function isItemStreaming(item: AgentItem): boolean {
  return item.status === 'pending' || item.status === 'running'
}

/** True if an item finished in a failed state. */
export function hasItemError(item: AgentItem): boolean {
  return item.status === 'failed'
}

// ---- Turn --------------------------------------------------------------------

/**
 * Why a turn stopped. Explicit (vs. inferred) so autonomous runs and budgets
 * can branch on it and the UI can show an honest terminal state.
 */
export type StopReason =
  | 'complete'
  | 'blocked'
  | 'budget_exhausted'
  | 'timeout'
  | 'user_stopped'
  | 'max_turns'
  | 'error'
