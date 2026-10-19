import { useConversationMode } from '../../model/useConversationMode'
import { ConversationModeControl } from './ConversationModeControl'

/** The mode control bound to its session; nothing for a draft or a session that is not a chat. */
export function SessionConversationModeChip({ sessionId }: { sessionId: string | null }) {
  const conversation = useConversationMode(sessionId)
  if (!sessionId || !conversation.editable) return null
  return (
    <ConversationModeControl
      value={conversation.mode}
      onChange={conversation.setMode}
      canBeSolo={conversation.canBeSolo}
    />
  )
}
