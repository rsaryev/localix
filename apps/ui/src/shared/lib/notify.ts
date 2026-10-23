import type { ReactNode } from 'react'
import { recordClientFact } from './notifications/clientFacts'
import { acknowledgeInline } from './notifications/inlineReport'
import { transientFeedback } from './notifications/transientFeedback'
import type { NotificationAction, NotificationSeverity } from './notifications/types'
import type { NotificationOrigin } from './notifications/types'
import { clearProblemReport, publishProblemReport } from './notifications/problems'
import type { PublishProblemsOptions } from './notifications/problems'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

type ToastMessage = string | ReactNode
type ToastId = string | number
type NotificationOptionAction = {
  label: ReactNode
  onClick: (...args: unknown[]) => void
}
interface NotificationOptions {
  id?: ToastId
  description?: ReactNode
  action?: NotificationOptionAction | ReactNode
  cancel?: NotificationOptionAction | ReactNode
  /** Structured provenance for publishers that know a more precise resource than the active chat. */
  origin?: NotificationOrigin
  /**
   * Who published this, for a row that would otherwise read "System" — a mini app's display name,
   * set by the host's attribution (`shared/contrib/miniAppToast.ts`). A LABEL on the row's origin,
   * not an origin of its own: the row still files under the chat it happened in.
   */
  source?: string
}

/**
 * Compatibility-shaped notification publisher. Call sites keep the familiar
 * `toast.error(message, options)` syntax, routed by what the call MEANS:
 *
 * - `error` / `warning` — something went wrong; a durable Event Center row.
 * - `info` / `success` / `message` / the bare call — an answer to the person's own action
 *   ("Copied", "Nothing to undo"). These used to be durable rows too, which made every click an
 *   unread badge and buried the failures the journal is for. They now go to the host's one
 *   transient line (`notifications/transientFeedback.ts`) and are gone after a few seconds:
 *   no row, no count, no banner. A surface with a natural anchor shows the kit's
 *   `ActionFeedback` beside the control instead of calling these.
 */

/**
 * How long a toast's `action`/`cancel` stays clickable on its durable row.
 *
 * The call shape is a toast's, and a toast's buttons were a choice for the moment it was on screen:
 * "Undo" the rename just made, "Force push" the push just rejected. The row outlives that moment by
 * hours, and the callback closes over state that has since moved on. A minute is long enough to
 * open the bell after noticing the row, and short enough that nothing stale is left to click. A
 * choice that stays valid for as long as its condition holds belongs in `toast.problems`, whose
 * recovery actions do not expire.
 */
export const TOAST_ACTION_LIFETIME_MS = 60_000

function titleOf(message: ToastMessage): string {
  if (typeof message === 'string') return message
  if (typeof message === 'number') return String(message)
  return 'Notification'
}

function bodyOf(opts?: NotificationOptions): string | undefined {
  const d = opts?.description
  return typeof d === 'string' ? d : undefined
}

function actionOf(
  value: NotificationOptions['action'],
  id: 'action' | 'cancel',
): NotificationAction | null {
  if (!value || typeof value !== 'object' || !('label' in value) || !('onClick' in value)) {
    return null
  }
  const label = typeof value.label === 'string' ? value.label : undefined
  const onClick = value.onClick
  return label && typeof onClick === 'function'
    ? {
        id,
        label,
        kind: 'callback',
        onClick: () => onClick(),
        available: true,
        expiresAt: Date.now() + TOAST_ACTION_LIFETIME_MS,
      }
    : null
}

function actionsOf(opts?: NotificationOptions): NotificationAction[] | undefined {
  const actions = [actionOf(opts?.action, 'action'), actionOf(opts?.cancel, 'cancel')].filter(
    (action): action is NotificationAction => action !== null,
  )
  return actions.length > 0 ? actions : undefined
}

let transientSequence = 0

/** An answer to the person's own action: the transient line, never a row (see the header). */
function answer(
  tone: 'info' | 'success',
  message: ToastMessage,
  opts?: NotificationOptions,
): ToastId {
  const action = opts?.action
  const followUp =
    action && typeof action === 'object' && 'label' in action && 'onClick' in action
      ? action
      : undefined
  const detail = bodyOf(opts)
  transientFeedback.show(titleOf(message), {
    tone,
    ...(detail ? { detail } : {}),
    ...(followUp && typeof followUp.label === 'string'
      ? { action: { label: followUp.label, onClick: () => followUp.onClick() } }
      : {}),
  })
  // An answer given right after a failed request ("Branch already exists" from a refused create)
  // is the caller's report of it. As a journal row it acknowledged the failure on the way in; as
  // a transient line it must too, or the transport's generic row would now appear beside it.
  acknowledgeInline()
  transientSequence += 1
  return opts?.id ?? `transient:${transientSequence.toString(36)}`
}

function publish(
  severity: NotificationSeverity,
  message: ToastMessage,
  opts?: NotificationOptions,
): ToastId {
  // An anonymous event: a per-invocation key, and an identical repeat folds into one row with a
  // count (`clientFacts.ts`). Its buttons are callbacks and stay in this window (`overlay.ts`).
  const key = recordClientFact({
    severity,
    title: titleOf(message),
    body: bodyOf(opts),
    origin: opts?.origin,
    originLabel: opts?.source,
    actions: actionsOf(opts),
    // Worth a banner only when something went wrong; the shared policy still decides whether now.
    ...(severity === 'warning' || severity === 'error' ? { nativeKind: 'run' as const } : {}),
  })
  return opts?.id ?? key
}

interface ToastFn {
  (message: ToastMessage, opts?: NotificationOptions): ToastId
  success: (message: ToastMessage, opts?: NotificationOptions) => ToastId
  error: (message: ToastMessage, opts?: NotificationOptions) => ToastId
  info: (message: ToastMessage, opts?: NotificationOptions) => ToastId
  warning: (message: ToastMessage, opts?: NotificationOptions) => ToastId
  message: (message: ToastMessage, opts?: NotificationOptions) => ToastId
  /**
   * A structured problem report rather than a sentence. Same destination, but the centre gets the
   * field, the line and the fix instead of a flattened string — and repeated publishes of the same
   * standing problems coalesce into one row.
   */
  problems: (report: ProblemReport, options: PublishProblemsOptions) => string | undefined
  /** The subject is healthy again: settle whatever the centre still says about it. */
  problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) => void
  /** The caller shows this failure inline, so no generic row duplicates it (`inlineReport.ts`). */
  acknowledgeInline: (error?: unknown) => void
}

const base = (message: ToastMessage, opts?: NotificationOptions): ToastId => {
  return answer('info', message, opts)
}

export const toast: ToastFn = Object.assign(base, {
  success: (m: ToastMessage, o?: NotificationOptions) => answer('success', m, o),
  error: (m: ToastMessage, o?: NotificationOptions) => publish('error', m, o),
  info: (m: ToastMessage, o?: NotificationOptions) => answer('info', m, o),
  warning: (m: ToastMessage, o?: NotificationOptions) => publish('warning', m, o),
  message: (m: ToastMessage, o?: NotificationOptions) => answer('info', m, o),
  problems: publishProblemReport,
  problemsCleared: clearProblemReport,
  acknowledgeInline,
})
