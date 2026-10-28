/**
 * Helpers for test harness components that must hand something out of a render — the value a hook
 * returned, or a pre-built DOM node for the hook's ref. They live outside the component body so the
 * harness states what it does (observe a render) without reassigning variables from inside it.
 */

/** Where a harness leaves what it rendered with, for the test to read after `act`. */
export interface Tap<T> {
  readonly value: T | undefined
  put(next: T): void
}

export function tap<T>(): Tap<T> {
  let held: T | undefined
  return {
    get value() {
      return held
    },
    put(next) {
      held = next
    },
  }
}

/** Hand a hook's ref an element during render, so the hook's own effects already see it. */
export function adopt<T>(ref: { current: T | null }, element: T): void {
  ref.current = element
}

/** How many times a harness rendered; `tick()` from the render, `value` after `act`. */
export interface Counter {
  readonly value: number
  tick(): void
}

export function counter(): Counter {
  let count = 0
  return {
    get value() {
      return count
    },
    tick() {
      count += 1
    },
  }
}
