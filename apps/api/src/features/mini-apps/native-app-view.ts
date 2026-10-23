import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import { isUiNavigationAction } from '@localixai/mini-app-sdk/ui'

import { isRecord } from '../../lib/record'

/**
 * The destination a native mini app tool OFFERED: its `details` is a `ui.navigate` action
 * (`ctx.ui.offer`), or carries one under `details.reveal` beside its own data.
 */
export function offeredAppViewUri(details: unknown): string | undefined {
  if (isUiNavigationAction(details)) return details.uri
  if (isRecord(details) && isUiNavigationAction(details.reveal)) return details.reveal.uri
  return undefined
}

/**
 * Tell the model where a mini app tool's offer leads. A mini app never reveals a view itself —
 * the person gets a button, and the agent decides whether to show it with the `open` tool —
 * so the URI has to reach the model too, or the agent cannot open what the tool produced.
 * The line is added once, here, for every native mini app tool, and only when the result does
 * not name that URI already.
 */
export function withAppViewLine(result: AgentToolResult): AgentToolResult {
  if (!isRecord(result) || typeof result.content !== 'string') return result
  const uri = offeredAppViewUri(result.details)
  if (!uri || result.content.includes(uri)) return result
  const line = `App view: ${uri}`
  return {
    ...result,
    content: result.content ? `${result.content}\n${line}` : line,
    ...(result.contentParts
      ? { contentParts: [...result.contentParts, { type: 'text' as const, text: line }] }
      : {}),
  }
}

/** The tool's `execute`, with {@link withAppViewLine} applied to each result it returns. */
export function withAppViewResults(tool: AgentTool): AgentTool['execute'] {
  return async (...args) => withAppViewLine(await tool.execute(...args))
}
