/**
 * What a finished tool result KEEPS: the text it said, and the images it returned, stored as
 * media so the item carries a `mediaId` rather than megabytes of base64.
 *
 * Before this the item kept only the result flattened to a string, where every image had become
 * the literal `[image]`. The picture existed inside its own run and nowhere else: the next turn
 * replayed `[image]` (the model then said, correctly, that it could not see the screenshot) and
 * the tool card printed the same placeholder. Any tool that returns an image — a browser
 * screenshot, an image `read`, an MCP picture — goes through here, so the fix is one path, not one
 * per tool.
 *
 * With no media store there is nowhere durable to put the bytes, and inlining them into the row is
 * the thing this exists to avoid, so the result keeps its old text-only shape.
 */
import type { ImageContent, TextContent, FileContent } from '@localixai/agent'
import type { ToolImageAttachment } from '@localixai/agent/agents'

import type { MediaStore } from '../../../media/store'
import { storeMediaAttachments } from '../../../media/attachments'

export interface PersistedToolResult {
  resultText?: string
  attachments?: ToolImageAttachment[]
}

export async function persistToolResultMedia(
  result: { content: unknown; contentParts?: Array<TextContent | ImageContent | FileContent> },
  store: MediaStore | undefined,
): Promise<PersistedToolResult> {
  const contentText = typeof result.content === 'string' ? result.content : undefined
  const images = (result.contentParts ?? []).filter(
    (part): part is ImageContent => part.type === 'image',
  )
  if (images.length === 0 || !store) return { resultText: contentText }

  // The text the tool said, without the `[image]` markers its flattened form carries: the images
  // now travel as attachments, so a marker beside them would only describe itself.
  const text = (result.contentParts ?? [])
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('')
  const stored = await storeMediaAttachments(
    store,
    images.map((image, index) => ({
      kind: 'image' as const,
      mediaType: image.mediaType,
      data: image.data,
      name: `image-${index + 1}`,
      size: Math.floor((image.data.length * 3) / 4),
    })),
  )
  return {
    resultText: text || contentText,
    attachments: stored.filter((att): att is ToolImageAttachment => att.kind === 'image'),
  }
}
