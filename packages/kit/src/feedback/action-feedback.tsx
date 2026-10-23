import { useState, useSyncExternalStore } from 'react'
import { Check, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { TextAction } from '../controls/text-action'
import {
  ACTION_FEEDBACK_MS,
  createActionFeedbackStore,
  type ActionFeedbackStore,
  type ActionFeedbackTone,
} from './action-feedback-store'

/**
 * A short answer to the person's own action, at the control they used, gone after a few seconds.
 *
 * Without it the only place to say "Copied" or "Nothing to export" was the durable journal, which
 * turned every click into a row with an unread badge (`action-feedback-store.ts` says why that is
 * wrong). This renders the answer beside the control instead and never writes anything anywhere.
 *
 * The live region is ALWAYS mounted, empty between answers: a screen reader announces a CHANGE
 * inside a region it already knows, and a region that mounts together with its text is often not
 * announced at all. It is `role="status"` (polite), because an answer to a click must not cut off
 * what is being read. A failure is not feedback — it stays on `ProblemLine` or the journal — which
 * is why the tones stop at `warning` (a no-op the person may want to know about).
 */

const TONE_TEXT: Record<ActionFeedbackTone, string> = {
  info: 'text-text-soft',
  success: 'text-status-success',
  warning: 'text-status-warning',
}

const TONE_ICON = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
} as const

/** A store owned by one control: show from its handler, render `ActionFeedback` beside it. */
export function useActionFeedback(durationMs = ACTION_FEEDBACK_MS): ActionFeedbackStore {
  const [store] = useState(() => createActionFeedbackStore(durationMs))
  return store
}

export interface ActionFeedbackProps {
  store: ActionFeedbackStore
  className?: string
}

export function ActionFeedback({ store, className }: ActionFeedbackProps) {
  const feedback = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const Icon = feedback ? TONE_ICON[feedback.tone] : null
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-slot="action-feedback"
      data-tone={feedback?.tone}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-xs',
        // Never `hidden` while empty: `display: none` takes the region out of the accessibility
        // tree, and the next answer would land in a region the reader has never seen.
        feedback && TONE_TEXT[feedback.tone],
        className,
      )}
      onPointerEnter={() => store.hold(true)}
      onPointerLeave={() => store.hold(false)}
      onFocus={() => store.hold(true)}
      onBlur={() => store.hold(false)}
    >
      {feedback && Icon && (
        <>
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          {/* Keyed by id: the same sentence shown twice is two answers and is announced twice. */}
          <span
            key={feedback.id}
            className="min-w-0 truncate"
            // The line truncates; the whole answer stays one hover away.
            title={feedback.detail ? `${feedback.message} · ${feedback.detail}` : undefined}
          >
            {feedback.message}
            {feedback.detail && <span className="text-text-faint"> · {feedback.detail}</span>}
          </span>
          {feedback.action && (
            <TextAction
              className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
              onClick={() => {
                const action = feedback.action
                store.clear()
                action?.onClick()
              }}
            >
              {feedback.action.label}
            </TextAction>
          )}
        </>
      )}
    </span>
  )
}
