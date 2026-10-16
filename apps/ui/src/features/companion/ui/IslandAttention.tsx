import { ArrowRight, MessageCircleQuestion } from 'lucide-react'
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
  deferred,
  onDeferredChange,
  onNext,
  onOpen,
  onResolved,
}: {
  item: AttentionItem
  session: UiSession | undefined
  count: number
  active: boolean
  deferred: boolean
  onDeferredChange: (deferred: boolean) => void
  onNext: () => void
  onOpen: () => void
  onResolved: () => void
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface-hover">
      {deferred ? (
        <Button
          variant="ghost"
          size="lg"
          className="w-full justify-start gap-2"
          aria-label={`Reply to agent: ${item.title}`}
          onClick={() => onDeferredChange(false)}
        >
          <MessageCircleQuestion className="shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
          <ArrowRight />
        </Button>
      ) : (
        <CompanionRequest
          item={item}
          session={session}
          keyboardActive={active}
          onClose={() => onDeferredChange(true)}
          onOpen={onOpen}
          onResolved={onResolved}
        />
      )}
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
