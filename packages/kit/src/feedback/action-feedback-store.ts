/**
 * The clock behind a transient answer to something the person just did.
 *
 * "Copied", "Nothing to undo", "Branch already exists" used to be written to the durable journal as
 * rows of their own: each one raised the bell's unread count and stayed there for hours, so the
 * journal read as a log of clicks and the failures it exists for were buried under them. An answer
 * to a click belongs where the click happened, for as long as it takes to read, and then nowhere.
 *
 * This is that lifetime, framework-free, so the anchored `ActionFeedback` a surface renders and the
 * host's one fallback line for calls with no anchor run on the same clock instead of two timers that
 * drift. One message at a time: a newer answer REPLACES the older one, because two answers to two
 * clicks side by side are a log again. Holding (pointer over it, focus inside it) stops the clock,
 * so a reader is never cut off mid-sentence and an "Undo" is never pulled from under the pointer.
 */

export type ActionFeedbackTone = 'info' | 'success' | 'warning'

/** How long an answer stays, unheld: long enough to read a short line once. */
export const ACTION_FEEDBACK_MS = 4_000

export interface ActionFeedbackAction {
  label: string
  onClick: () => void
}

export interface ActionFeedbackInput {
  tone?: ActionFeedbackTone
  /** A quieter second clause after the answer — why nothing happened, what to do instead. */
  detail?: string
  /** One follow-up the answer offers — "Undo", "Show". Taking it clears the answer. */
  action?: ActionFeedbackAction
}

export interface ActionFeedbackMessage {
  /** Increases with every show, so a repeat of the same sentence re-announces. */
  id: number
  message: string
  tone: ActionFeedbackTone
  detail?: string
  action?: ActionFeedbackAction
}

export interface ActionFeedbackStore {
  show: (message: string, input?: ActionFeedbackInput) => void
  clear: () => void
  /** True while the person is reading or reaching for it; the clock restarts on release. */
  hold: (held: boolean) => void
  getSnapshot: () => ActionFeedbackMessage | null
  subscribe: (listener: () => void) => () => void
}

export function createActionFeedbackStore(durationMs = ACTION_FEEDBACK_MS): ActionFeedbackStore {
  let current: ActionFeedbackMessage | null = null
  let sequence = 0
  let held = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const stopClock = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const startClock = () => {
    stopClock()
    if (!current || held) return
    timer = setTimeout(() => {
      timer = undefined
      current = null
      emit()
    }, durationMs)
  }

  return {
    show(message, input) {
      sequence += 1
      current = {
        id: sequence,
        message,
        tone: input?.tone ?? 'info',
        ...(input?.detail ? { detail: input.detail } : {}),
        ...(input?.action ? { action: input.action } : {}),
      }
      startClock()
      emit()
    },
    clear() {
      stopClock()
      held = false
      if (!current) return
      current = null
      emit()
    },
    hold(next) {
      if (held === next) return
      held = next
      if (held) stopClock()
      else startClock()
    },
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
