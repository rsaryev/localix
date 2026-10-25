/**
 * How a provider tells the Store its listings moved: its own writes call `changed`, and `heard` is
 * where changes made elsewhere arrive (the capability revision, an update pass). `subscribe` is the
 * provider's `subscribe`, and its unsubscribe stops both.
 */
export function createChangeSignal(heard?: (listener: () => void) => () => void) {
  const listeners = new Set<() => void>()
  return {
    changed: (): void => {
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      const stop = heard?.(listener)
      return () => {
        listeners.delete(listener)
        stop?.()
      }
    },
  }
}
