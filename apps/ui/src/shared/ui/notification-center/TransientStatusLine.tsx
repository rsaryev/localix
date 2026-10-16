import { ActionFeedback } from '@localixai/kit/action-feedback'
import { transientFeedback } from '@/shared/lib/notifications/transientFeedback'

/**
 * Where `toast.info`/`toast.success` answers appear when their caller had no control to anchor
 * them to (`transientFeedback.ts` says why they are not journal rows). One line on the window's
 * status bar, always mounted so its live region exists before the first answer; it carries the
 * status bar's own top seam so the empty slot is indistinguishable from the bar around it.
 */
export function TransientStatusLine() {
  return (
    <div className="flex min-w-0 max-w-[40%] shrink items-center border-t border-border-soft px-2.5">
      <ActionFeedback store={transientFeedback} className="text-2xs" />
    </div>
  )
}
