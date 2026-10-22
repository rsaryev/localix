/**
 * IMAGES AND FILES in a request: user content and tool results as the provider SDK's parts.
 *
 * A model that cannot read images is sent a short placeholder where one was, so a conversation
 * that once carried a screenshot stays usable after switching to a text-only model. The
 * OpenAI-compatible wire carries only text in a tool message (its SDK would inline the image as
 * base64 JSON, megabytes of it), so there the result says where its images went and they follow
 * in a user message.
 */
import type {
  LanguageModelV4FilePart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider'
import type { FileContent, ImageContent, TextContent, ToolResult } from '@localixai/agent'

export const IMAGE_OMITTED = '(image omitted: model does not support images)'
const IMAGE_ATTACHED = '(see the attached image)'
const FILE_OMITTED = '(attachment omitted: this API takes no files in tool results)'
const NO_OUTPUT = '(no tool output)'

type Content = string | Array<TextContent | ImageContent | FileContent>

function fileData(data: string) {
  return { type: 'data' as const, data }
}

function mediaPart(part: ImageContent | FileContent): LanguageModelV4FilePart {
  return {
    type: 'file',
    mediaType: part.mediaType,
    data: fileData(part.data),
    ...(part.type === 'file' && part.filename ? { filename: part.filename } : {}),
  }
}

function partsOf(content: Content): Array<TextContent | ImageContent | FileContent> {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

/** A user message's content, images replaced when the model cannot read them. */
export function userParts(
  content: Content,
  images: boolean,
): Array<LanguageModelV4TextPart | LanguageModelV4FilePart> {
  return partsOf(content).map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : part.type === 'image' && !images
        ? { type: 'text', text: IMAGE_OMITTED }
        : mediaPart(part),
  )
}

/** How a tool result is shaped for this model. */
export interface ToolOutputShape {
  /** The model reads images. */
  images: boolean
  /** The tool message carries text only (the OpenAI-compatible wire). */
  textOnly: boolean
}

/**
 * A tool result as the SDK's output, and the images that must follow it in a user message
 * (the text-only wire). A failure keeps its error flag: media cannot ride with one, so a failed
 * result says how many images it left out.
 */
export function toolOutput(
  result: ToolResult,
  shape: ToolOutputShape,
): { output: LanguageModelV4ToolResultOutput; follow: LanguageModelV4FilePart[] } {
  const parts = partsOf(result.content)
  const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
  const media = parts.filter((part): part is ImageContent | FileContent => part.type !== 'text')
  if (media.length === 0)
    return {
      output: result.isError ? { type: 'error-text', value: text } : { type: 'text', value: text },
      follow: [],
    }
  if (result.isError) {
    const note = `(${media.length} attachment${media.length === 1 ? '' : 's'} omitted from this failed result)`
    return { output: { type: 'error-text', value: text ? `${text}\n${note}` : note }, follow: [] }
  }
  if (shape.textOnly) {
    // Only images can follow in a user message there; any other attachment is named, not sent.
    const attached = shape.images ? media.filter((part) => part.type === 'image') : []
    const notes = [
      ...(attached.length > 0 ? [IMAGE_ATTACHED] : []),
      ...(media.some((part) => part.type === 'image') && !shape.images ? [IMAGE_OMITTED] : []),
      ...(media.some((part) => part.type !== 'image') ? [FILE_OMITTED] : []),
    ]
    const value = [text, ...notes].filter(Boolean).join('\n') || NO_OUTPUT
    return { output: { type: 'text', value }, follow: attached.map(mediaPart) }
  }
  return {
    output: {
      type: 'content',
      value: parts.map((part) =>
        part.type === 'text'
          ? { type: 'text' as const, text: part.text }
          : part.type === 'image' && !shape.images
            ? { type: 'text' as const, text: IMAGE_OMITTED }
            : { ...mediaPart(part), type: 'file' as const },
      ),
    },
    follow: [],
  }
}

/** The user message carrying the images a text-only tool message could not. */
export function attachedFromTools(follow: LanguageModelV4FilePart[]): {
  role: 'user'
  content: Array<LanguageModelV4TextPart | LanguageModelV4FilePart>
} {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, ...follow],
  }
}
