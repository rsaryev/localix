/**
 * The gate every action the app CANNOT TAKE BACK passes through.
 *
 * Two families arrive here, and they are the same question. An OUTWARD action hands something to
 * the world outside the app — a link to the OS browser, a path to the file manager, a payload to a
 * third-party service — where the app has no further say. An IRREVERSIBLE local action throws away
 * state with no undo behind it: a layout reset, a wiped event history, every keybinding override
 * dropped at once. Both are "there is no going back from this", and both deserve the same sentence
 * on the same surface.
 *
 * Nothing here knows what a URL or a layout is. A caller describes WHAT it is about to do and HOW
 * to do it; this module owns only the asking. That is what lets the next one of these reuse the
 * same confirmation, the same host and the same guarantees instead of growing a second prompt —
 * which is exactly what the app had before: a settings page with an inline "Sure?", a sidebar row
 * with two tiny buttons, and a rail button that reset the whole workspace on one click.
 *
 * Held outside React because the callers are event handlers and plain modules — a palette command
 * and a rail button have nowhere to render a dialog of their own. A single React host renders it
 * and reports the decision back. Same idiom as the other external stores in this codebase.
 *
 * Reach for a plain `ConfirmDialog` instead when the surface asking is already a React component
 * that owns the state behind the question (a sidebar holding the row it is about to delete). This
 * gate is for the callers that are not.
 */

export interface ConfirmableAction {
  /**
   * The family this belongs to (`'external-link'`, `'reset-layout'`, …). Not used for wording —
   * the caller already supplies that — but it keeps the record legible and lets a
   * future host treat a family differently without learning every caller.
   */
  kind: string
  /** The question, as a person would ask it. */
  title: string
  /**
   * What is actually at stake, shown VERBATIM: the full URL for a handoff, the list of things a
   * reset drops. The whole point of asking is that the person can see exactly what their click
   * is about to do.
   */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  /** Do the thing. Called only after an explicit yes. */
  perform: () => void
  /** Report acceptance or cancellation to workflows that must stop on a refusal. */
  onDecision?: (proceed: boolean) => void
}

/** What the host renders — the descriptor minus the callback it must not invoke itself. */
export type PendingConfirmation = Omit<ConfirmableAction, 'perform' | 'onDecision'>

let pending: ConfirmableAction | null = null
/**
 * The value `useSyncExternalStore` reads. CACHED, not rebuilt per call:
 * `getSnapshot` is compared by IDENTITY, so returning a fresh object each time
 * makes React see a change on every render and loop until it throws "Maximum
 * update depth exceeded". Rebuilt only when `pending` actually changes.
 */
let snapshot: PendingConfirmation | null = null
let mountedHosts = 0
const listeners = new Set<() => void>()

function setPending(next: ConfirmableAction | null): void {
  pending = next
  snapshot = next
    ? {
        kind: next.kind,
        title: next.title,
        detail: next.detail,
        confirmLabel: next.confirmLabel,
        cancelLabel: next.cancelLabel,
        variant: next.variant,
      }
    : null
  for (const listener of listeners) listener()
}

/**
 * The dialog host announces itself here.
 *
 * Without a mounted host there is nobody to answer, so {@link requestConfirmation}
 * performs IMMEDIATELY rather than parking a request nothing will ever settle. A
 * confirmation nobody can see would just be a new way for an action to do
 * nothing, which is the failure this gate exists to remove.
 */
export function registerConfirmationHost(): () => void {
  mountedHosts += 1
  return () => {
    mountedHosts = Math.max(0, mountedHosts - 1)
    // The host went away with a question on screen: answer it rather than
    // stranding the caller.
    if (mountedHosts === 0 && pending) decideConfirmation(false)
  }
}

export function subscribeConfirmation(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pendingConfirmation(): PendingConfirmation | null {
  return snapshot
}

export function decideConfirmation(proceed: boolean): void {
  const current = pending
  setPending(null)
  try {
    if (proceed) current?.perform()
  } finally {
    current?.onDecision?.(proceed)
  }
}

/** Ask first, then do it. */
export function requestConfirmation(action: ConfirmableAction): void {
  if (mountedHosts === 0) {
    action.perform()
    action.onDecision?.(true)
    return
  }
  // A question is already on screen. It is modal, so this is a rare race (a
  // programmatic request landing behind a click); the newer one wins and the
  // older is answered as declined rather than left hanging.
  if (pending) decideConfirmation(false)
  setPending(action)
}

/** Test seam: drop any pending question and forget mounted hosts. */
export function resetConfirmationsForTests(): void {
  decideConfirmation(false)
  snapshot = null
  mountedHosts = 0
  listeners.clear()
}
