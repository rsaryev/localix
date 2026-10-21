import { useRef } from 'react'
import type { AttentionItem } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { HitlAttentionBody } from '@/entities/chat/ui/attention/HitlAttentionBody'
import { useIslandInputFocus } from '../model/useIslandInputFocus'

export function CompanionRequest({
  item,
  session,
  onOpen,
  onResolved,
  keyboardActive,
}: {
  item: AttentionItem
  session: UiSession | undefined
  onOpen: () => void
  onResolved: () => void
  keyboardActive: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useIslandInputFocus(ref, keyboardActive, item.key)
  return (
    <div ref={ref}>
      {item.kind === 'interaction' && (
        <HitlAttentionBody
          embedded
          keyboardActive={keyboardActive}
          item={item}
          session={session}
          sessionTitle={session?.title || 'Background conversation'}
          openChat={onOpen}
          settle={onResolved}
        />
      )}
    </div>
  )
}
