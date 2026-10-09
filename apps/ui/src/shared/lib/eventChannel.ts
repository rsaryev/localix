/** Synchronous, unbuffered handoff between owners in different UI slices. */
export function createEventChannel<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>()

  return {
    publish(...args: Args): void {
      // Preserve live Set delivery: removals take effect immediately and listeners
      // added during delivery receive the event. Handler errors propagate to the caller.
      listeners.forEach((listener) => listener(...args))
    },
    subscribe(listener: (...args: Args) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
