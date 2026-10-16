import {
  assetBindings,
  type ChatMessage,
  type TextContent,
  type ImageContent,
  type FileContent,
} from '..'
import type { ToolBackedItem } from './items'

/** Allowed image media types for the wire `ImageContent` part. */
const IMAGE_MEDIA_TYPES = new Set<ImageContent['mediaType']>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/**
 * Whether the wire can carry these bytes as a real `ImageContent` part.
 *
 * THE boundary, in one place. It used to be re-listed in the pi codec and again in the
 * composer, and the copies were consistent — but the SPILL decision asked a different
 * question ("is it an image?") and so excluded every `image/*` from spilling on the
 * grounds that "pi carries ImageContent". That grounds only holds for these four: a
 * HEIC, SVG, BMP or TIFF was excluded from spilling AND unrepresentable on the wire, so
 * it reached the model as the bare text stub `[Attached file: x.heic]`. Anything this
 * returns false for must be given to the model as a FILE ON DISK, not as bytes.
 */
export function isWireCarriableImage(mediaType: string): boolean {
  return IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase() as ImageContent['mediaType'])
}

/**
 * What to send when an attachment reaches the wire with no bytes.
 *
 * Dropping the part is the one thing that must not happen. The user can see the file
 * attached in their message, so silence makes the model answer as if nothing were
 * attached — it cannot tell the user that the file never arrived, because it does not
 * know one was meant to. A visible failure the model can report beats an invisible one.
 * So an unsendable part is replaced with text that states the problem and says to tell
 * the user.
 */
function missingBytes(att: { name?: string; mediaType: string }): TextContent {
  const what = att.name ? `"${att.name}"` : att.mediaType
  return {
    type: 'text',
    text:
      `The attachment ${what} could not be loaded — its content was unavailable when this ` +
      `message was prepared, so you cannot see it. Tell the user it did not reach you.`,
  }
}

/**
 * Build the wire content for a user message. Context/invocation bindings are
 * materialized by the host before this SDK boundary; only asset bindings become
 * provider content parts here.
 */
export function userMessageContent(
  message: ChatMessage,
): string | Array<TextContent | ImageContent | FileContent> {
  const attachments = assetBindings(message.bindings)
  if (attachments.length === 0) return message.content ?? ''

  const parts: Array<TextContent | ImageContent | FileContent> = []
  if (message.content) parts.push({ type: 'text', text: message.content })

  for (const att of attachments) {
    if (att.kind === 'image' && IMAGE_MEDIA_TYPES.has(att.mediaType as ImageContent['mediaType'])) {
      // A file-backed attachment whose bytes weren't rehydrated by the host has no
      // `data`. An empty wire part is not an option (the SDK never reads `mediaId`;
      // rehydration is the host's job) — but neither is dropping it, see `missingBytes`.
      if (att.data)
        parts.push({
          type: 'image',
          mediaType: att.mediaType as ImageContent['mediaType'],
          data: att.data,
        })
      else parts.push(missingBytes(att))
    } else if (
      att.kind === 'image' ||
      att.kind === 'file' ||
      att.kind === 'audio' ||
      att.kind === 'video'
    ) {
      // Non-standard image types, audio, and video fall through to a generic
      // file part (generated video on assistant replies is never re-sent, but a
      // user-attached clip should ride as a file rather than a text stub).
      if (att.data)
        parts.push({ type: 'file', mediaType: att.mediaType, data: att.data, filename: att.name })
      else parts.push(missingBytes(att))
    } else if (att.kind === 'text') {
      // A spilled attachment's `text` is already a self-contained manifest (path +
      // head preview + re-read instructions), and a context-ref expansion's `text`
      // is already a self-contained block (header + fenced content) — both are
      // produced host-side and emitted raw, not re-fenced as a code block. A
      // normal (inlined) text attachment is fenced.
      if (att.spilled || att.contextRef) parts.push({ type: 'text', text: att.text })
      else
        parts.push({
          type: 'text',
          text: `Attached file: ${att.name}\n\n\`\`\`\n${att.text}\n\`\`\``,
        })
    } else if (att.kind === 'path') {
      // Path attachments are host-owned resources, just like `mediaId`: the SDK never
      // reads them, and the host replaces the persisted path with a spilled-text manifest
      // on its model-wire copy. If one still arrives here that replacement did not run —
      // so name the path instead of emitting nothing. The model has file tools and the
      // path is all it needs, which turns a silent loss into a usable attachment.
      parts.push({
        type: 'text',
        text:
          `The user attached the file at ${att.path}, but its contents were not inlined. ` +
          `Read it from that path if you need it.`,
      })
    }
  }

  return parts.length > 0 ? parts : (message.content ?? '')
}

/**
 * A tool result's wire content: its text, then the images it returned.
 *
 * The bytes are the host's to supply — it rehydrates `data` from the media store onto the wire
 * copy, and only when this request's model accepts images. An image without `data` is therefore
 * one this request must not carry, and it is NAMED rather than dropped, for the same reason as
 * {@link missingBytes}: a model that reads "the screenshot is not shown" says so, while one that
 * reads nothing may describe a picture it never saw.
 */
export function withToolImages(
  text: string,
  attachments: ToolBackedItem['attachments'],
): string | Array<TextContent | ImageContent> {
  if (!attachments?.length) return text
  const parts: Array<TextContent | ImageContent> = text ? [{ type: 'text', text }] : []
  for (const att of attachments) {
    if (att.data && IMAGE_MEDIA_TYPES.has(att.mediaType as ImageContent['mediaType']))
      parts.push({
        type: 'image',
        mediaType: att.mediaType as ImageContent['mediaType'],
        data: att.data,
      })
    else
      parts.push({
        type: 'text',
        text: '[The image this tool returned is not included in this request.]',
      })
  }
  return parts
}
