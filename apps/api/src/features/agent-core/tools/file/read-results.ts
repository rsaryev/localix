import type { AgentToolUpdateCallback } from '@localixai/agent/agents'
import { fileSource } from '../source-refs'
import { truncateOutput } from './read-output'
import type { ReadToolDetails } from './read-contracts'

/** Keep UI output, model content, and provenance on one synchronous return path. */
export function createReadResponder(
  targetPath: string,
  onUpdate?: AgentToolUpdateCallback<ReadToolDetails>,
) {
  const respond = (
    output: string,
    meta: { bytes: number; truncated?: boolean; content?: string; isError?: true },
  ) => {
    const details: ReadToolDetails = {
      path: targetPath,
      bytes: meta.bytes,
      truncated: meta.truncated ?? false,
      output,
    }
    onUpdate?.(details)
    return {
      content: meta.content ?? output,
      details,
      // Provenance for the answer's Sources list. One place, because `respond` is the single
      // exit of all seven branches — a per-branch source would be seven chances to forget one.
      // A failed read still publishes, marked `failed`: "we tried to look at this and could
      // not" is part of what informed the answer, and the answer UI hides it while the tool
      // card keeps it.
      sources: [
        fileSource({
          path: targetPath,
          ...(meta.isError ? { status: 'failed' as const } : {}),
        }),
      ],
      ...(meta.isError ? { isError: true as const } : {}),
    }
  }

  const dirResult = (listing: string) => {
    const truncated = truncateOutput(listing)
    return respond(truncated.output, { bytes: truncated.bytes, truncated: truncated.truncated })
  }

  return { respond, dirResult }
}
