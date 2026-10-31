import type { AttentionItem } from '@localixai/api/client'
import { HitlAttentionBody } from '@/entities/chat/ui/attention/HitlAttentionBody'

/**
 * A request that blocks a run, in the card the app itself uses: its title, Deny, Approve rightmost,
 * Enter and Escape, the deadline. The answer goes through the same calls as in the chat; the island
 * only decides where the card sits and when the keyboard may answer it.
 */
export function IslandRequest({
  item,
  sessionTitle,
  keyboardActive,
  onOpenChat,
  onSettled,
}: {
  item: AttentionItem
  sessionTitle: string
  /** Enter and Escape answer only after the person clicked or typed in this card. */
  keyboardActive: boolean
  onOpenChat: () => void
  onSettled: () => void
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface-hover">
      <HitlAttentionBody
        embedded
        item={item}
        session={undefined}
        sessionTitle={sessionTitle}
        keyboardActive={keyboardActive}
        openChat={onOpenChat}
        settle={onSettled}
      />
    </div>
  )
}
