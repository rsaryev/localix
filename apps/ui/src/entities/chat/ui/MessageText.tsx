import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { ActionSurfaceProvider } from '@localixai/mini-app-sdk/ui'

interface MessageTextProps {
  text: string
  isStreaming?: boolean
  /** Render `@path` tokens as clickable file-mention chips (user messages). */
  linkifyMentions?: boolean
  /** The conversation's members — `@handle` becomes a clickable agent chip. */
  mentionHandles?: readonly string[]
  /** Assistant prose may refer to a known agent by handle without writing `@`. */
  linkifyAgentNames?: boolean
}

export function MessageText({
  text,
  isStreaming,
  linkifyMentions,
  mentionHandles,
  linkifyAgentNames,
}: MessageTextProps) {
  return (
    <ActionSurfaceProvider surface={isStreaming ? null : 'chat.content'}>
      <div className="w-full">
        <MarkdownRenderer
          isStreaming={isStreaming}
          linkifyMentions={linkifyMentions}
          mentionHandles={mentionHandles}
          linkifyAgentNames={linkifyAgentNames}
        >
          {text}
        </MarkdownRenderer>
      </div>
    </ActionSurfaceProvider>
  )
}
