import type { ImageContent, TextContent } from '@localixai/agent'
import type { AgentSource, AgentToolUpdateCallback } from '@localixai/agent/agents'
import { fileSource } from '../source-refs'
import { truncateOutput } from './read-output'
import type { ReadToolDetails } from './read-contracts'

/** What one read (a single call, or one item of a batch) answers. */
export interface ReadItemResult {
  content: string
  contentParts?: Array<TextContent | ImageContent>
  details: ReadToolDetails
  sources: AgentSource[]
  isError?: true
}

/** Keep UI output, model content, and provenance on one synchronous return path. */
export function createReadResponder(
  targetPath: string,
  onUpdate?: AgentToolUpdateCallback<ReadToolDetails>,
) {
  const respond = (
    output: string,
    meta: {
      bytes: number
      truncated?: boolean
      content?: string
      isError?: true
      /** Image/notebook facts for the card (`kind`, media type, pixel size). */
      extra?: Pick<ReadToolDetails, 'kind' | 'mediaType' | 'width' | 'height'>
      /** Images for the model; a text part carrying `content` leads them. */
      images?: ImageContent[]
    },
  ): ReadItemResult => {
    const details: ReadToolDetails = {
      path: targetPath,
      bytes: meta.bytes,
      truncated: meta.truncated ?? false,
      output,
      ...meta.extra,
    }
    const content = meta.content ?? output
    // Parts replace `content` on the wire, so the text goes first as its own part.
    const contentParts: Array<TextContent | ImageContent> | undefined = meta.images?.length
      ? [{ type: 'text', text: content }, ...meta.images]
      : undefined
    onUpdate?.(details)
    return {
      content,
      ...(contentParts ? { contentParts } : {}),
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
