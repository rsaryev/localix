import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import { formatSize, textEncoderByteLength } from '@localixai/agent'

import { isIndexSkippedTool } from './index-policy'
import type { ContextStore } from './repository'

/**
 * Durable tool-result append barrier.
 *
 * Pi awaits this hook before it appends the result and advances to the next model
 * request. Commit the exact sanitized tool I/O here, then (and only then) mint a
 * recovery pointer. The later runtime-event consumer remains asynchronous and
 * is no longer part of pointer correctness. The existing per-request wire policy
 * bounds the model copy after this barrier, while the runtime event/UI retains
 * the full result. FTS indexing is best-effort because exact recovery does not
 * depend on it.
 */

/**
 * Model-facing bytes past which a result is worth indexing. Below this, the whole
 * result fits comfortably in context and a search pointer is dead weight; above
 * it, the result is exactly the kind the wire layers will truncate or crush, and
 * chunk-level recall starts beating retrieve-everything.
 */
export const EXTERNALIZE_THRESHOLD_BYTES = 20_000

export interface ExternalizeOptions {
  userId: string
  sessionId: string
  threshold?: number
  /**
   * Host secret shield for tool arguments. Required because this hook is a
   * durable persistence boundary; callers without a shield must pass a
   * fail-closed sanitizer that drops the input.
   */
  sanitizeInput: (value: unknown) => unknown
  /** Whether the current model roster can follow the appended search pointer. */
  toolOutputAvailable?: boolean
}

export function buildExternalizeAfterToolCall(
  store: ContextStore,
  options: ExternalizeOptions,
): NonNullable<AgentRuntimeRunInput['afterToolCall']> {
  const threshold = options.threshold ?? EXTERNALIZE_THRESHOLD_BYTES
  return async ({ toolCallId, toolName, input, result }) => {
    // Persist the RICHEST sanitized copy. Bash and filtered tools may retain raw
    // output in details.output even when their ordinary model text is shorter.
    const details = result.details as { output?: unknown; kind?: unknown } | undefined
    const raw = typeof details?.output === 'string' ? details.output : ''
    const rawBytes = textEncoderByteLength(raw)
    const contentBytes = textEncoderByteLength(result.content)
    const text = rawBytes > contentBytes ? raw : result.content
    const textBytes = rawBytes > contentBytes ? rawBytes : contentBytes

    // Mandatory durability barrier. Do not catch this write: returning a bounded
    // result after it failed would expose a tool_output pointer with no source.
    const safeInput = options.sanitizeInput(input)
    await store.putToolOutputArtifact({
      userId: options.userId,
      sessionId: options.sessionId,
      toolCallId,
      toolName,
      text,
      toolInput: safeInput,
      isError: result.isError === true,
    })

    let sections = 0
    let covered: 'full' | 'prefix' = 'full'
    const shouldIndex =
      !result.isError &&
      !result.supersedeKey &&
      details?.kind !== 'image' &&
      !isIndexSkippedTool(toolName) &&
      textBytes >= threshold
    if (shouldIndex) {
      try {
        const indexed = await store.indexToolOutput({
          userId: options.userId,
          sessionId: options.sessionId,
          toolCallId,
          toolName,
          text,
        })
        // Assign only after the complete index write succeeds.
        if (indexed.sections > 0) {
          sections = indexed.sections
          covered = indexed.covered
        }
      } catch {
        // Search is an optimization. Exact retrieval is already durable.
      }
    }

    // Keep indexing for a later turn that may re-enable tool_output, but do
    // not advertise a call the current model cannot make.
    if (sections === 0 || options.toolOutputAvailable === false) return undefined
    // Say WHICH part is indexed when chunking dropped the tail. "400 sections of this
    // 5.0 MB output are indexed" reads as full coverage to a model that has no idea 400 is
    // the cap, and a later search over the unindexed tail would report a plain absence.
    const scope =
      covered === 'prefix'
        ? `the first ${sections} sections of this ${formatSize(textBytes)} output are indexed (its tail is not)`
        : `${sections} sections of this ${formatSize(textBytes)} output are indexed`
    return {
      content:
        result.content +
        `\n\n[${scope} — ` +
        `tool_output(action="search", queries=[…], tool_call_id="${toolCallId}") finds matching sections without replaying it all` +
        `${covered === 'prefix' ? '; tool_output action="get" has the whole text' : ''}]`,
    }
  }
}
