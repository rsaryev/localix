/**
 * Shared synthetic-transcript builders for the VBC context-compression tests.
 * Kept tiny + dependency-free so each *.test.ts can import what it needs.
 *
 * The compression engine now operates on the normalized `AgentItem` model, so the
 * builders produce tool-backed items. `toolItem`/`namedTool` map a tool name to the
 * right item shape: write/edit/apply_patch/patch → `file_change`, bash/shell/terminal
 * → `command`, everything else → generic `tool_call`.
 */
/**
 * A budget so large it never binds — the "no budget pressure, show me only the
 * lossless downgrades" case. NOT `Infinity`: an infinite budget means "no window
 * information at all", which `planContextCompression` treats as a documented no-op.
 */
export const HUGE_BUDGET = 1_000_000_000

import type { ChatMessage, MessageAttachment } from '../chat'
import type {
  AgentItem,
  AgentItemStatus,
  CommandItem,
  FileChange,
  FileChangeItem,
  ToolCallItem,
  ToolBackedItem,
} from '../agents/items'

let toolSeq = 0

const MUTATE_NAMES = new Set(['write', 'edit', 'apply_patch', 'patch'])
const COMMAND_NAMES = new Set(['bash', 'shell', 'terminal'])

// Map a legacy tool-call state onto an item status (output-available → completed,
// output-error → failed, input-* → pending) so ported fixtures read the same.
type LegacyState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
function statusFor(state: LegacyState | undefined): AgentItemStatus {
  if (state === 'output-error') return 'failed'
  if (state === 'input-available' || state === 'input-streaming') return 'pending'
  return 'completed'
}

export interface ItemOverrides {
  state?: LegacyState
  status?: AgentItemStatus
  input?: unknown
  resultText?: string
  errorText?: string
  thoughtSignature?: string
  /** For file_change items, override the structured changes. */
  changes?: FileChange[]
}

/** Build a tool-backed item for `name`, dispatching to the right item type. */
export function namedTool(name: string, input: unknown, over: ItemOverrides = {}): ToolBackedItem {
  const id = `call-${++toolSeq}`
  const status = over.status ?? statusFor(over.state)
  const base = {
    id,
    toolCallId: id,
    name,
    input,
    status,
    thoughtSignature: over.thoughtSignature,
  } as const
  const inputRec = (
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  ) as Record<string, unknown>

  if (MUTATE_NAMES.has(name)) {
    const changes: FileChange[] =
      over.changes ??
      pathsFromInput(name, inputRec).map((path) => ({ path, kind: 'modify' as const }))
    const item: FileChangeItem = {
      ...base,
      type: 'file_change',
      changes,
      resultText: over.resultText,
      errorText: over.errorText,
    }
    return item
  }
  if (COMMAND_NAMES.has(name)) {
    const command = typeof inputRec.command === 'string' ? inputRec.command : ''
    const item: CommandItem = {
      ...base,
      type: 'command',
      command,
      output: over.resultText,
      resultText: over.resultText,
      errorText: over.errorText,
    }
    return item
  }
  const item: ToolCallItem = {
    ...base,
    type: 'tool_call',
    activeVerb: name,
    output: over.resultText,
    resultText: over.resultText,
    errorText: over.errorText,
  }
  return item
}

/** Generic command item (defaults to bash). Mirrors the old `toolPart()` default. */
export function toolItem(over: ItemOverrides & { name?: string } = {}): ToolBackedItem {
  const name = over.name ?? 'bash'
  // Honor an explicit `input: undefined` (token tests rely on 0 input chars).
  const input = 'input' in over ? over.input : { command: 'run' }
  return namedTool(name, input, over)
}

// Extract candidate paths from a mutation tool's input for the synthetic file_change.
function pathsFromInput(name: string, input: Record<string, unknown>): string[] {
  if ((name === 'apply_patch' || name === 'patch') && typeof input.patch === 'string') {
    return patchPaths(input.patch)
  }
  for (const f of ['path', 'file', 'file_path']) {
    const v = input[f]
    if (typeof v === 'string' && v.trim()) return [v]
  }
  return []
}

const PATCH_PATH_RE = /^\*\*\* (?:Add File|Update File|Delete File|Move to):?\s+(.+)$/gm
function patchPaths(patch: string): string[] {
  const out: string[] = []
  PATCH_PATH_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PATCH_PATH_RE.exec(patch)) !== null) {
    const p = m[1]?.trim()
    if (p) out.push(p)
  }
  return out
}

let msgSeq = 0

/** Build a ChatMessage. Defaults: assistant role, unique id. Accepts `items`. */
export function msg(over: Partial<ChatMessage> & { items?: AgentItem[] } = {}): ChatMessage {
  return {
    id: `m${++msgSeq}`,
    role: 'assistant',
    ...over,
  }
}

/** Build a user message with text content. */
export function userMsg(content: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return msg({ role: 'user', content, ...over })
}

/** An image attachment (for token tests). */
export function imageAttachment(name = 'pic.png'): MessageAttachment {
  return { kind: 'image', mediaType: 'image/png', data: 'AAAA', name, size: 4 }
}

/** A text attachment (counts as chars, not image tokens). */
export function textAttachment(text: string, name = 'note.txt'): MessageAttachment {
  return { kind: 'text', name, text, size: text.length }
}
