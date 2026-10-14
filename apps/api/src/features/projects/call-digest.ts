/**
 * Pure builder for the `@call:<toolCallId>` context-ref expansion — a COMPACT
 * digest of one tool call from the sending session's transcript: tool name,
 * status, the key input (command / file paths / arguments), and a BOUNDED
 * excerpt of the model-facing result. Failed calls always carry their error
 * line — linking a failing call to ask "why did this break?" is the primary
 * use-case. The header points the agent at the history tools for a full read.
 *
 * Kept free of DB / chat imports so the extraction + trimming rules stay
 * unit-testable. The caller (bootstrap) finds the persisted item by toolCallId
 * and maps it into `CallDigestInput`.
 */

/** Max chars of pretty-printed input shown. */
export const CALL_INPUT_CHARS = 400
/** Head chars kept from the result text. */
export const CALL_RESULT_HEAD_CHARS = 400
/** Tail chars kept from the result text (shown when the middle is elided). */
export const CALL_RESULT_TAIL_CHARS = 200
/** Max chars of the error line. */
export const CALL_ERROR_CHARS = 400

/**
 * The persisted tool-backed item, reduced to what the digest needs. Mirrors the
 * shared `ToolBackedItem` fields (structural — no @localixai/agent import so this
 * stays a pure leaf).
 */
export interface CallDigestInput {
  /** The sending session's id (e.g. `LOCALIX-42`). */
  sessionId: string
  toolCallId: string
  /** Tool name as the model called it (`bash`, `edit`, an MCP tool…). */
  name: string
  status: string
  /** Item type — command / file_change / mcp_call / tool_call. */
  itemType: string
  /** Parsed tool arguments from the model. */
  input?: unknown
  /** command items: the shell command (preferred over raw input). */
  command?: string
  /** file_change items: the touched paths. */
  changedPaths?: string[]
  /** Model-facing result string. */
  resultText?: string
  errorText?: string
}

const clip = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max).trimEnd()}…` : s

/** One-line pretty of the key input for the digest header. */
export function callInputSummary(input: CallDigestInput): string | null {
  if (input.command) return clip(input.command, CALL_INPUT_CHARS)
  if (input.changedPaths && input.changedPaths.length > 0) {
    return clip(input.changedPaths.join(', '), CALL_INPUT_CHARS)
  }
  if (input.input === undefined || input.input === null) return null
  const raw = typeof input.input === 'string' ? input.input : JSON.stringify(input.input)
  if (!raw || raw === '{}') return null
  return clip(raw, CALL_INPUT_CHARS)
}

/** Head…tail excerpt of the result text (whitespace-normalized ends). */
export function callResultExcerpt(resultText: string): string {
  const text = resultText.trim()
  if (text.length <= CALL_RESULT_HEAD_CHARS + CALL_RESULT_TAIL_CHARS) return text
  const head = text.slice(0, CALL_RESULT_HEAD_CHARS).trimEnd()
  const tail = text.slice(-CALL_RESULT_TAIL_CHARS).trimStart()
  return `${head}\n[…middle elided…]\n${tail}`
}

/** Renders the digest markdown block for one linked tool call. */
export function buildCallDigest(input: CallDigestInput): string {
  const failed = input.status === 'failed' || Boolean(input.errorText)
  const lines: string[] = []
  lines.push(
    `Tool call ${input.toolCallId} — \`${input.name}\` (${failed ? 'FAILED' : input.status}) in session ${input.sessionId}`,
  )

  const inputSummary = callInputSummary(input)
  if (inputSummary) lines.push(`Input: ${inputSummary}`)

  if (input.resultText?.trim()) {
    lines.push('')
    lines.push('Result:')
    lines.push(callResultExcerpt(input.resultText))
  }

  if (input.errorText?.trim()) {
    lines.push('')
    lines.push(`Error: ${clip(input.errorText.trim(), CALL_ERROR_CHARS)}`)
  }

  lines.push('')
  lines.push(
    "(Digest of one tool call from this session's transcript. The full input/output is in the conversation history — scroll back or use the history tools to read more.)",
  )
  return lines.join('\n')
}
