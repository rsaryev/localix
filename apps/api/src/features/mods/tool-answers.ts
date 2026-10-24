import type { AgentToolResult } from '@localixai/agent/agents'
import { claudeCodeToolResponse } from '../ext/cc-tool-shapes'

/**
 * What `tool.call`'s core answers and what a hook's answer becomes. Core answers Claude Code's
 * shape: the tool's own record (`result`, per tool: `ext/cc-tool-responses.ts`), the text the model
 * reads (`text`), a `ref` naming the call's real result, and `isError` when it failed. A hook that
 * hands that answer back gets the tool's result as it ran; its own `{ result }` is what the model
 * reads in the tool's place, and its `context` lines are read after it.
 */

type Fields = Record<string, unknown>

/** Refused by a mod's `tool.call` hook; the failure guard stamps it `blocked` by name. */
export class ModToolDeniedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ModToolDeniedError'
  }
}

/** The real results core answered with, by `ref`; a few are kept while their calls settle. */
const ran = new Map<number, { result: AgentToolResult; record: string }>()
const KEPT = 256
let lastRef = 0

/** Core's answer for one call the tool ran, in Claude Code's shape. */
export function coreAnswer(
  tool: { name: string },
  /** The call's Localix input, and the directory its paths resolve in. */
  input: Fields,
  result: AgentToolResult,
  cwd?: string,
): Fields {
  const record = claudeCodeToolResponse(tool, result, input, cwd)
  const ref = ++lastRef
  ran.set(ref, { result, record: JSON.stringify(record) ?? '' })
  if (ran.size > KEPT) ran.delete(ran.keys().next().value!)
  return {
    result: record,
    text: result.content,
    ref,
    ...(result.isError ? { isError: true } : {}),
  }
}

const contextOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string' && line !== '')
    : []

/** The tool result the model reads for what the chain answered. */
export function resultOf(answer: unknown, fallback: AgentToolResult): AgentToolResult {
  if (!answer || typeof answer !== 'object') return fallback
  const record = answer as Fields
  if (typeof record.deny === 'string') throw new ModToolDeniedError(record.deny)
  const context = contextOf(record.context)
  const withContext = (result: AgentToolResult): AgentToolResult =>
    context.length === 0
      ? result
      : { ...result, content: [result.content, ...context].join('\n\n') }
  const kept = typeof record.ref === 'number' ? ran.get(record.ref) : undefined
  // Handed back as core answered it (the record unchanged): the call's real result stands.
  if (kept && JSON.stringify(record.result) === kept.record) return withContext(kept.result)
  if (record.result === undefined) return withContext(fallback)
  const content =
    typeof record.result === 'string' ? record.result : JSON.stringify(record.result, null, 2)
  return withContext({ content, ...(record.isError === true ? { isError: true } : {}) })
}
