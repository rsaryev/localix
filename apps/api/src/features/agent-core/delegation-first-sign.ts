/**
 * A CHILD'S FIRST SIGN OF LIFE — what ends the window a delegating call watches it through.
 *
 * `Agent` returns as soon as the child is launched, but not blindly: a role that fails to resolve
 * or a provider that refuses ends the child before its first token, and the delegator should hear
 * that in the same turn rather than as a wake minutes later. That needed a window, and the window
 * was a fixed sleep — so every launch took its full length even when the child was streaming
 * after a few hundred milliseconds, and three background launches were 1.2 s apart (LOCALIX-430).
 *
 * The window is still the bound, but the child's first streamed output ends it: from then on the
 * child is demonstrably running, and nothing a launch could report is still to come. The run's
 * event handler notes it (`chat/runtime/run/event-handlers.ts`); the launch watches it
 * (`chat/runtime/run/task-delegation-options.ts`). In-process, like the lanes.
 */

const watching = new Map<string, () => void>()

/** Watch `childId` for its first output. Register before the child starts, so none is missed. */
export function watchFirstSign(childId: string): { seen: Promise<void>; stop: () => void } {
  let release!: () => void
  const seen = new Promise<void>((resolve) => (release = resolve))
  watching.set(childId, release)
  return {
    seen,
    stop: () => {
      if (watching.get(childId) === release) watching.delete(childId)
    },
  }
}

/** The child streamed output. Cheap and idempotent: a child nobody watches, or already seen, is a no-op. */
export function noteChildStreaming(childId: string): void {
  const release = watching.get(childId)
  if (!release) return
  watching.delete(childId)
  release()
}
