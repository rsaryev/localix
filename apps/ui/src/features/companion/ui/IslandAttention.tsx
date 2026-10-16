import { ArrowRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import type { AttentionItem } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { CompanionRequest } from './CompanionRequest'

/** Present the existing request where the user already is, with its real answer controls. */
export function IslandAttention({
  item,
  session,
  count,
  active,
  onNext,
  onOpen,
  onResolved,
}: {
  item: AttentionItem
  session: UiSession | undefined
  count: number
  active: boolean
  onNext: () => void
  onOpen: () => void
  onResolved: () => void
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface-hover">
      <CompanionRequest
        item={item}
        session={session}
        keyboardActive={active}
        onOpen={onOpen}
        onResolved={onResolved}
      />
      {count > 1 && (
        <div className="flex justify-end border-t border-border-soft px-2 py-1">
          <Button variant="ghost" size="xs" onClick={onNext}>
            Next request · {count}
            <ArrowRight />
          </Button>
        </div>
      )}
    </div>
  )
}
