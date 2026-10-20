/** A set of listeners and the one call that tells them all; `on` hands back the unsubscribe. */
export function createSignal() {
  const listeners = new Set<() => void>()
  return {
    emit: () => listeners.forEach((listener) => listener()),
    on(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
