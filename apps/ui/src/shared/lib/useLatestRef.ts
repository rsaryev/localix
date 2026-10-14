import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref that always holds the LATEST value, for callbacks bound ONCE into a long-lived
 * imperative subsystem (an xterm key handler, a Monaco extension, a WebSocket
 * listener) that therefore captured whatever closure existed at mount.
 *
 * Without it, such a handler keeps calling the first render's function forever — a
 * silent staleness bug, since the call still succeeds, just against dead state. Reading
 * `ref.current()` at call time instead fixes it without re-binding the subsystem on every
 * render (which is the thing we were avoiding in the first place).
 *
 * Written in an EFFECT, never during render: a ref mutated while rendering is not safe
 * under concurrent rendering.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
