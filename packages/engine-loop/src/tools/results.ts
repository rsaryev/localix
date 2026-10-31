/**
 * The shapes a call's result takes on its way to the model: the error and cancellation results
 * every stage settles with, the after-hook's patch folded in, and the parts the model reads.
 */
import type { TextContent, ImageContent, FileContent } from '@localixai/agent'
import type { AfterToolCallResult, AgentToolResult } from '@localixai/agent/agents'

/** What a thrown value says: an Error's message, anything else as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function errorResult(message: string): AgentToolResult {
  return { content: message, isError: true }
}

/**
 * A call that ended because the run was stopped — before it started, while it waited, or while
 * it ran. One shape everywhere, so every surface reads it as cancelled rather than failed.
 */
export function abortedResult(content = 'Operation aborted'): AgentToolResult {
  return {
    content,
    isError: true,
    error: { kind: 'aborted', message: 'The run was stopped', userMessage: 'Stopped' },
  }
}

/** What a call the model chose before it could read the person's new message gets back. */
export const DEFERRED_TEXT =
  'Not run: the user sent a message before this call started. Read it first, then re-issue this call if it still applies.'

/** Whether a message waits for the model. A host probe that throws must never fail a call. */
export async function messageWaits(
  shouldDefer: (() => boolean | Promise<boolean>) | undefined,
): Promise<boolean> {
  try {
    return (await shouldDefer?.()) === true
  } catch {
    return false
  }
}

/** Mark a result the stop cut short as cancelled, keeping the output it had already made. */
export function markAborted(result: AgentToolResult): AgentToolResult {
  if (result.error) return result
  return { ...result, isError: true, error: abortedResult().error }
}

/**
 * Fold the after-hook's patch into the result. New text replaces the text the model reads, not
 * the media beside it: a reminder appended to a screenshot's result must not cost the screenshot.
 */
export function applyAfterPatch(
  result: AgentToolResult,
  patch: AfterToolCallResult | undefined,
): AgentToolResult {
  if (!patch) return result
  const media = result.contentParts?.filter((part) => part.type !== 'text')
  return {
    ...result,
    ...(patch.content !== undefined
      ? { content: patch.content, contentParts: media && media.length > 0 ? media : undefined }
      : {}),
    ...(patch.isError !== undefined ? { isError: patch.isError } : {}),
    ...(patch.terminate !== undefined ? { terminate: patch.terminate } : {}),
  }
}

/** The parts the model reads: the media a tool returned, led by its text when they lack one. */
export function modelParts(
  result: AgentToolResult,
): Array<TextContent | ImageContent | FileContent> {
  const parts = result.contentParts
  if (!parts) return [{ type: 'text', text: result.content }]
  if (!result.content || parts.some((part) => part.type === 'text')) return parts
  return [{ type: 'text', text: result.content }, ...parts]
}

export function textOf(parts: ReadonlyArray<TextContent | ImageContent | FileContent>): string {
  return parts
    .map((part) =>
      part.type === 'text' ? part.text : part.type === 'image' ? '[image]' : '[file]',
    )
    .join('')
}
