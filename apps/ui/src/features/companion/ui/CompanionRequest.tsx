import { lazy, Suspense, useRef } from 'react'
import type { AttentionItem } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { HitlAttentionBody } from '@/features/chat/ui/attention/HitlAttentionBody'
import { useIslandInputFocus } from '../model/useIslandInputFocus'

const CompanionQuestion = lazy(() => import('./CompanionQuestion'))

export function CompanionRequest({
  item,
  session,
  onClose,
  onOpen,
  onResolved,
  keyboardActive,
}: {
  item: AttentionItem
  session: UiSession | undefined
  onClose: () => void
  onOpen: () => void
  onResolved: () => void
  keyboardActive: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useIslandInputFocus(ref, keyboardActive, item.key)
  return (
    <div ref={ref}>
      {item.kind === 'interaction' ? (
        <HitlAttentionBody
          embedded
          keyboardActive={keyboardActive}
          item={item}
          session={session}
          sessionTitle={session?.title || 'Background conversation'}
          openChat={onOpen}
          settle={onResolved}
        />
      ) : (
        <Suspense fallback={<LoadingHint>Opening question…</LoadingHint>}>
          <CompanionQuestion
            keyboardActive={keyboardActive}
            item={item}
            session={session}
            onClose={onClose}
            onOpen={onOpen}
            onResolved={onResolved}
          />
        </Suspense>
      )}
    </div>
  )
}
