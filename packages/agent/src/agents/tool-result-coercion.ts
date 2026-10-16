import type { AgentToolResult } from './types'
import { normalizeAgentSources } from './sources'

/**
 * Coerce any value returned by a tool's execute() into a valid AgentToolResult.
 * Provides a single safety boundary so a misbehaving third-party tool can never
 * crash the agent loop.
 */
export function coerceToolResult(value: unknown): AgentToolResult {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AgentToolResult).content === 'string'
  ) {
    const result = value as AgentToolResult
    if (result.sources === undefined) return result
    return { ...result, sources: normalizeAgentSources(result.sources) }
  }
  let detail: string
  try {
    detail =
      typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'symbol' || typeof value === 'function'
          ? Object.prototype.toString.call(value)
          : String(value as string | number | boolean | bigint | undefined)
  } catch {
    // Diagnostics must never defeat this safety boundary. Circular objects and
    // BigInt-containing plugin results are invalid, but still need coercing into
    // a normal tool error so the agent loop can continue.
    detail = '<unprintable value>'
  }
  console.warn(
    '[localixai/agent] Tool returned an unexpected value — coercing to error result:',
    detail,
  )
  return {
    content: 'Tool returned an unexpected value',
    isError: true,
    error: {
      kind: 'execution',
      message: `Tool returned ${typeof value} instead of AgentToolResult`,
      userMessage: 'Tool failed',
      retryable: false,
      fatal: false,
    },
  }
}
