import { Store } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import type { UpdateOffer } from '@/shared/lib/background-activity/activityItems'
import {
  dismissUpdateOffer,
  isUpdateOfferDismissed,
  useUpdateDismissals,
} from '@/shared/lib/background-activity/dismissals'

/**
 * The Store's updates on offer above the composer — every package kind in one offer, so an update
 * is not forgotten without the strip turning into a stack. It can be hidden until what it offers
 * changes (`dismissals.ts`); the Event Center lists it anyway. While an update runs, the strip
 * shows how far it is instead of its action. The app's own update has its own row.
 */
export function UpdateOffersRow({ offers }: { offers: readonly UpdateOffer[] }) {
  useUpdateDismissals()
  const offer = offers.find((each) => each.id !== 'app' && !isUpdateOfferDismissed(each))
  if (!offer) return null
  return (
    <WorkbenchNoticeBar
      role="status"
      icon={<Store className="size-3.5" />}
      title={offer.title}
      description={offer.running?.status ?? offer.detail}
      actionsLabel="Update actions"
      actions={
        offer.running ? (
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
        ) : null
      }
      onDismiss={() => dismissUpdateOffer(offer)}
      dismissLabel="Hide until there are newer updates"
    />
  )
}
