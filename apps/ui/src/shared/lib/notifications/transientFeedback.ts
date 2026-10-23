import { createActionFeedbackStore } from '@localixai/kit/action-feedback'

/**
 * The host's ONE transient line, for an answer to the person's own action that has no control to
 * stand beside.
 *
 * `toast.info` and `toast.success` are called from hundreds of handlers — menu rows that close as
 * they fire, keyboard shortcuts, mini app actions — and most have no element left to anchor an
 * answer to. They used to write a durable journal row each, so "Copied" raised the same unread
 * badge as a failed run. Re-routing them is only half a fix if the answer then vanishes, so it
 * lands here: one slot on the status bar, the same clock as the kit's anchored `ActionFeedback`,
 * and nothing persisted, counted or bannered.
 *
 * A surface that HAS a natural anchor renders its own `ActionFeedback` with `useActionFeedback()`
 * instead; this line is the fallback, not the default for new code.
 */
export const transientFeedback = createActionFeedbackStore()
