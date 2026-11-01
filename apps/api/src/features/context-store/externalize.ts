import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import { formatSize, jsonDigest, textEncoderByteLength } from '@localixai/agent'

import { isIndexSkippedTool } from '../agent-core/context-index-policy'
import { spillFullOutput } from '../agent-core/tools/bash/bash-output'
import { TOOL } from '../agent-core/tool-names'
import type { ContextStore } from './repository'

/**
 * Durable tool-result append barrier.
 *
 * The loop awaits this hook before it appends the result and advances to the next model
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

/**
 * Model-facing bytes past which a JSON result is replaced by a digest. Well above the index
 * threshold: a result this size is already beyond what the model reads usefully in one piece.
 */
export const JSON_DIGEST_THRESHOLD_BYTES = 32_000

/**
 * Tools whose text the model asked for verbatim (a file's content, a command's own output).
 * Shell output has its own spill and tail cap. A recovered result (ToolOutput) is already
 * barred by the index-skip rule.
 */
const VERBATIM_TOOLS: ReadonlySet<string> = new Set([TOOL.Read, TOOL.Bash])

export interface ExternalizeOptions {
  /** Where a digested result's whole text is saved; the bash spill directory by default. */
  spillDir?: string
  userId: string
  sessionId: string
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
    // result after it failed would expose a ToolOutput pointer with no source.
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
      textBytes >= EXTERNALIZE_THRESHOLD_BYTES
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

    // A large JSON result (an MCP tool, a snapshot) reaches the model as a digest; its whole text
    // sits in a file it can read or grep. The pointer below then rides on the digest.
    let content = result.content
    let digested = false
    if (
      !result.isError &&
      contentBytes >= JSON_DIGEST_THRESHOLD_BYTES &&
      !VERBATIM_TOOLS.has(toolName) &&
      !isIndexSkippedTool(toolName) &&
      details?.kind !== 'image'
    ) {
      const digest = jsonDigest(result.content)
      const path =
        digest && (await spillFullOutput(digest.file, toolCallId, options.spillDir, 'json'))
      if (digest && path) {
        content = digest.render(path)
        digested = true
      }
    }

    // Keep indexing for a later turn that may re-enable ToolOutput, but do
    // not advertise a call the current model cannot make.
    if (sections === 0 || options.toolOutputAvailable === false) {
      return digested ? { content } : undefined
    }
    // Say WHICH part is indexed when chunking dropped the tail. "400 sections of this
    // 5.0 MB output are indexed" reads as full coverage to a model that has no idea 400 is
    // the cap, and a later search over the unindexed tail would report a plain absence.
    const scope =
      covered === 'prefix'
        ? `the first ${sections} sections of this ${formatSize(textBytes)} output are indexed (its tail is not)`
        : `${sections} sections of this ${formatSize(textBytes)} output are indexed`
    return {
      content:
        content +
        `\n\n[${scope} — ` +
        `ToolOutput(action="search", queries=[…], tool_call_id="${toolCallId}") finds matching sections without replaying it all` +
        `${covered === 'prefix' ? '; ToolOutput action="get" has the whole text' : ''}]`,
    }
  }
}
