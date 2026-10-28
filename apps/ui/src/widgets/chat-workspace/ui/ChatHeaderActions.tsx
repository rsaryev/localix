import { Search } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { SessionUsageIndicator } from '@/entities/chat/ui/prompt-input/SessionUsageIndicator'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { CMD, useChordHint } from '@/shared/lib/keybindings'
import { IconButton } from '@localixai/kit/icon-button'

interface ChatHeaderActionsProps {
  activeSessionId: string | null
  /** Whether the chat has messages — gates the Find-in-conversation button. */
  hasMessages?: boolean
  sessionUsage?: ChatUsagePayload
}

/**
 * Right-hand rail of the chat header. The Source Control / Terminal
 * shortcuts moved to the left activity rail (`useRailActions`) so every panel
 * opens from one consistent place. The Find button opens the in-conversation
 * search — the direct pointer path on touch devices without a hardware keyboard.
 */
export function ChatHeaderActions({
  activeSessionId,
  hasMessages,
  sessionUsage,
}: ChatHeaderActionsProps) {
  const openSearch = useMessageSearchStore((s) => s.setOpen)
  const chordHint = useChordHint()
  if (!activeSessionId) return null
  if (!hasMessages) return null
  return (
    <div
      role="group"
      aria-label="Conversation actions"
      className="flex h-full shrink-0 items-center"
    >
      <SessionUsageIndicator usage={sessionUsage} />
      <IconButton
        size="md"
        onClick={() => openSearch(true)}
        aria-label="Find in conversation"
        tooltip={chordHint('Find in conversation', CMD.findInChat)}
      >
        <Search className="size-4" />
      </IconButton>
    </div>
  )
}
