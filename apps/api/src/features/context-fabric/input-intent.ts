import type { MessageAttachment } from '@localixai/agent'

export interface InputContextDescriptor {
  kind: 'reference' | 'attachment'
  label: string
  mediaType?: string
}

export interface InputIntentContext {
  text: string
  descriptors: InputContextDescriptor[]
}

const REF_PATTERN = /@(file|folder|project|session|resource|terminal|call|task):([^\s]+)/g
const MAX_LABEL_CHARS = 160
const MAX_DESCRIPTORS = 12

export function buildInputIntentContext(
  text: string,
  attachments: MessageAttachment[] = [],
): InputIntentContext {
  const descriptors: InputContextDescriptor[] = []
  for (const match of text.matchAll(REF_PATTERN)) {
    descriptors.push({
      kind: 'reference',
      label: `@${match[1]}:${match[2]}`.slice(0, MAX_LABEL_CHARS),
    })
    if (descriptors.length >= MAX_DESCRIPTORS) break
  }
  for (const attachment of attachments) {
    if (descriptors.length >= MAX_DESCRIPTORS) break
    descriptors.push({
      kind: 'attachment',
      label: String(attachment.name ?? attachment.kind).slice(0, MAX_LABEL_CHARS),
      mediaType: 'mediaType' in attachment ? attachment.mediaType : undefined,
    })
  }
  return { text, descriptors }
}

export function renderInputIntentContext(input: InputIntentContext, maxTextChars = 2000): string {
  const blocks = [`User intent:\n${input.text.slice(0, maxTextChars)}`]
  if (input.descriptors.length > 0) {
    blocks.push(
      `Linked context descriptors (labels only; contents are not included):\n${input.descriptors
        .map(
          (item) => `- ${item.kind}: ${item.label}${item.mediaType ? ` (${item.mediaType})` : ''}`,
        )
        .join('\n')}`,
    )
  }
  return blocks.join('\n\n')
}
