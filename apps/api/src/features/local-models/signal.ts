/** A set of listeners and the one call that tells them all; `on` hands back the unsubscribe. */
export function createSignal() {
  const listeners = new Set<() => void>()
  return {
    emit: () => listeners.forEach((listener) => listener()),
    // An arrow, so `on` can be handed around on its own (`subscribe: progress.on`).
    on: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
