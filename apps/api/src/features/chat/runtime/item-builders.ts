import type { ToolErrorPayload } from '@localixai/agent'
export { classifyTool } from './item-classify'
import { classifyTool, jobFields } from './item-classify'
import { mutationInputPaths } from '@localixai/agent/agents'
import type {
  AgentItem,
  AgentItemStatus,
  AgentSource,
  AgentToolPresentation,
  FileChange,
  FileChangeKind,
  ToolBackedItem,
  ToolGateProvenance,
  ToolActionDescriptor,
  ToolImageAttachment,
} from '@localixai/agent/agents'

/**
 * App-layer item construction: the ONE place that knows our tool registry's names
 * and output schemas, mapping a finished/streaming tool call onto a normalized
 * `AgentItem` (see `@localixai/agent/agents` items — the agnostic contract). The core
 * stays tool-agnostic; this is where `bash` → `command`, `write/edit`
 * → `file_change`, `mcp__*` → `mcp_call`, and everything else → generic `tool_call`.
 *
 * Specialized extraction reads each tool's own `details` shape (BashToolDetails,
 * WriteToolDetails), so adding a richly-rendered
 * tool means: classify it here + add its extractor. Plugin/unknown tools need no
 * change — they fall through to `tool_call`.
 *
 * These are the PURE builders (no state); the stateful run-event accumulator lives
 * in `items.ts` and re-exports this module's surface for import stability.
 */

/** Canonical view of a tool call the runtime feeds in (streaming or finished). */
export interface ToolItemSpec {
  toolCallId: string
  name: string
  status: AgentItemStatus
  /** Parsed model arguments. */
  input?: unknown
  /** Tool result `details` (rich, tool-specific shape). */
  details?: unknown
  /** Model-facing result string (tool `content`). */
  resultText?: string
  /** Display-only resource provenance from the tool result. */
  sources?: AgentSource[]
  /** Images the tool returned, already stored as media (see ToolBackedBase.attachments). */
  attachments?: ToolImageAttachment[]
  errorText?: string
  error?: ToolErrorPayload
  /** Live-state supersede key from the result (persisted so stale same-key results
   *  collapse across turns; see ToolBackedBase.supersedeKey). */
  supersedeKey?: string
  /** Permission-gate provenance for non-default allows (see ToolBackedBase.gate). */
  gate?: ToolGateProvenance
  standalone?: boolean
  presentation?: AgentToolPresentation
  actions?: ToolActionDescriptor[]
  activeVerb: string
  turnIndex?: number
  contentIndex?: number
  thoughtSignature?: string
  api?: string
  provider?: string
  model?: string
  providerThinkingLevel?: string
  startedAt?: number
  completedAt?: number
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/** Extract `FileChange[]` from a file-mutating tool's details, per tool name. */
function extractFileChanges(
  name: string,
  details: Record<string, unknown> | undefined,
  input: unknown,
): FileChange[] {
  const kindOf = (record: Record<string, unknown>): FileChangeKind =>
    name === 'Write' && record.created === true ? 'add' : 'modify'
  // write/edit batch: one change per file the call named, the failed ones included — a file
  // that was left unchanged is still part of what the call tried, and the card says why.
  if (Array.isArray(details?.files)) {
    return details.files.flatMap((entry): FileChange[] => {
      const file = asRecord(entry)
      const path = str(file?.path)
      if (!file || !path) return []
      if (file.failed === true) {
        const failReason = str(file.error)
        return [{ path, kind: 'modify', failed: true, ...(failReason ? { failReason } : {}) }]
      }
      return [{ path, kind: kindOf(file), diff: str(file.diff) }]
    })
  }
  // A historical single-file result: the path at the top of the details.
  const path = str(details?.path)
  if (details && path) return [{ path, kind: kindOf(details), diff: str(details.diff) }]
  // Streaming / pre-result (or a refusal with no details): best-effort from the input args so
  // the card shows every path early — a batch names them per entry.
  return mutationInputPaths(input).map((p) => ({ path: p, kind: 'modify' as const }))
}

/** Split an `mcp__<server>__<tool>` name into its parts (best-effort). */
function parseMcpName(name: string): { server: string; tool: string } {
  const body = name.startsWith('mcp__')
    ? name.slice(5)
    : name.startsWith('mcp_')
      ? name.slice(4)
      : name
  const sep = body.indexOf('__')
  if (sep !== -1) return { server: body.slice(0, sep), tool: body.slice(sep + 2) }
  return { server: 'mcp', tool: body }
}

/**
 * Build a tool-backed `AgentItem` from a tool call's current state. Pure; the
 * runtime calls this on tool start (status `running`, no details) and again on
 * completion (status `completed`/`failed`, with details) — same function, the
 * item just gains fields as data arrives.
 */
export function buildToolItem(spec: ToolItemSpec): ToolBackedItem {
  const base = {
    id: spec.toolCallId,
    toolCallId: spec.toolCallId,
    name: spec.name,
    status: spec.status,
    input: spec.input,
    resultText: spec.resultText,
    sources: spec.sources,
    attachments: spec.attachments,
    errorText: spec.errorText,
    error: spec.error,
    supersedeKey: spec.supersedeKey,
    gate: spec.gate,
    standalone: spec.standalone,
    presentation: spec.presentation,
    actions: spec.actions,
    turnIndex: spec.turnIndex,
    contentIndex: spec.contentIndex,
    thoughtSignature: spec.thoughtSignature,
    api: spec.api,
    provider: spec.provider,
    model: spec.model,
    ...(spec.providerThinkingLevel ? { providerThinkingLevel: spec.providerThinkingLevel } : {}),
    startedAt: spec.startedAt,
    completedAt: spec.completedAt,
  }
  const details = asRecord(spec.details)
  // On the base, so a job is visible whatever tool started it — these used to live on the
  // command branch alone, which made any non-shell tool's job invisible to every surface
  // that renders one.
  const job = jobFields(details)

  // `bash` with an interactive `action` (open/screen/keys/type/...) isn't a shell
  // command — render it via the generic tool_call path (the terminal card) so the
  // rendered screen shows, not the command card.
  const isInteractiveBash = spec.name === 'Bash' && typeof asRecord(spec.input)?.action === 'string'
  const itemType = isInteractiveBash ? 'tool_call' : classifyTool(spec.name)

  switch (itemType) {
    case 'command':
      return {
        ...base,
        ...job,
        type: 'command',
        command: str(details?.command) ?? str(asRecord(spec.input)?.command) ?? '',
        cwd: str(details?.cwd),
        output: str(details?.output),
        exitCode: num(details?.exitCode),
        durationMs: num(details?.wallTimeMs),
        terminalId: str(details?.terminalId),
      }
    case 'file_change':
      return {
        ...base,
        type: 'file_change',
        changes: extractFileChanges(spec.name, details, spec.input),
      }
    case 'mcp_call': {
      const { server, tool } = parseMcpName(spec.name)
      return {
        ...base,
        ...job,
        type: 'mcp_call',
        server,
        tool,
        result: spec.details,
        durationMs: num(details?.durationMs),
      }
    }
    case 'tool_call':
      return {
        ...base,
        ...job,
        type: 'tool_call',
        output: spec.details,
        activeVerb: spec.activeVerb,
      }
  }
}

/** A narrative text item (assistant narration). */
export function textItem(
  id: string,
  text: string,
  turnIndex: number,
  status: AgentItemStatus = 'running',
): AgentItem {
  return { id, type: 'text', status, text, turnIndex }
}

/** A reasoning/thinking item. */
export function reasoningItem(
  id: string,
  text: string,
  turnIndex: number,
  status: AgentItemStatus = 'running',
): AgentItem {
  return { id, type: 'reasoning', status, text, turnIndex }
}
