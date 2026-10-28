import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { ActionSurfaceProvider } from '@localixai/mini-app-sdk/ui'

interface MessageTextProps {
  text: string
  isStreaming?: boolean
  /** Render `@path` tokens as clickable file-mention chips (user messages). */
  linkifyMentions?: boolean
}

export function MessageText({ text, isStreaming, linkifyMentions }: MessageTextProps) {
  return (
    <ActionSurfaceProvider surface={isStreaming ? null : 'chat.content'}>
      <div className="w-full">
        <MarkdownRenderer isStreaming={isStreaming} linkifyMentions={linkifyMentions}>
          {text}
        </MarkdownRenderer>
      </div>
    </ActionSurfaceProvider>
  )
}
