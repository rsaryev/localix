import { useEffect, useState } from 'react'
import { ChevronRight, LayoutGrid, Puzzle } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import type { UpdateOffer } from '@/shared/lib/background-activity/activityItems'
import {
  dismissUpdateOffer,
  isUpdateOfferDismissed,
  useUpdateDismissals,
} from '@/shared/lib/background-activity/dismissals'

/** How long one offer stays before the next takes its place. */
export const UPDATE_OFFER_ROTATE_MS = 8_000

const ICON = { 'mini-apps': LayoutGrid, plugins: Puzzle, app: LayoutGrid } as const

/**
 * The mini app and plugin updates on offer, one at a time, above the composer — so an update is
 * not forgotten without the strip turning into a stack. With more than one, the next takes the
 * place every {@link UPDATE_OFFER_ROTATE_MS} while the strip is on screen; never while the pointer
 * rests on it or focus is in it (the person is reading or about to press), never under reduced
 * motion, and Next always shows the other one. Each can be hidden until what it offers changes
 * (`dismissals.ts`); the Event Center lists it anyway. While an update runs, the strip shows how
 * far it is instead of its action.
 */
export function UpdateOffersRow({
  offers,
  rotateMs = UPDATE_OFFER_ROTATE_MS,
  reducedMotion,
}: {
  offers: readonly UpdateOffer[]
  rotateMs?: number
  reducedMotion: boolean
}) {
  useUpdateDismissals()
  const shown = offers.filter((offer) => offer.id !== 'app' && !isUpdateOfferDismissed(offer))
  const [index, setIndex] = useState(0)
  const [held, setHeld] = useState(false)
  const count = shown.length

  useEffect(() => {
    if (count < 2 || held || reducedMotion) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      setIndex((current) => (current + 1) % count)
    }, rotateMs)
    return () => window.clearInterval(timer)
  }, [count, held, reducedMotion, rotateMs])

  const offer = shown[index % Math.max(1, count)]
  if (!offer) return null
  const Icon = ICON[offer.id]
  return (
    <WorkbenchNoticeBar
      role="status"
      icon={<Icon className="size-3.5" />}
      title={offer.title}
      description={offer.running?.status ?? offer.detail}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false)
      }}
      actionsLabel="Update actions"
      actions={
        <>
          {offer.running ? (
            <ProgressBar
              value={offer.running.percent ?? 100}
              className="h-1 w-20"
              fillClassName={
                offer.running.percent === null
                  ? 'bg-foreground/20 animate-pulse motion-reduce:animate-none'
                  : 'bg-foreground/45'
              }
              aria-label={`${offer.title} progress`}
              {...(offer.running.percent === null
                ? { 'aria-valuetext': offer.running.status }
                : { 'aria-valuenow': offer.running.percent })}
            />
          ) : offer.action ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="font-normal"
              onClick={() => void offer.action?.run()}
            >
              {offer.action.label}
            </Button>
          ) : null}
          {count > 1 && (
            <IconButton
              size="xs"
              aria-label="Show the next update"
              tooltip={`${(index % count) + 1} of ${count}`}
              onClick={() => setIndex((current) => (current + 1) % count)}
            >
              <ChevronRight />
            </IconButton>
          )}
        </>
      }
      onDismiss={() => dismissUpdateOffer(offer)}
      dismissLabel="Hide until there are newer updates"
    />
  )
}
