import { useEffect, useLayoutEffect, useRef } from 'react'
import { useCommandState } from '@localixai/kit/command'

interface CmdkHighlightWatcherProps {
  /** Called whenever cmdk's highlighted item value changes (keyboard nav or pointer). */
  onHighlight: (value: string | undefined) => void
}

/**
 * A zero-render bridge that lifts cmdk's currently-highlighted item `value` up to
 * the picker. cmdk only fires `onValueChange` in controlled mode, but `state.value`
 * is reactively readable via `useCommandState` even uncontrolled — so this lets the
 * model detail panel follow the keyboard highlight without taking over cmdk's own
 * (well-tuned) navigation state. Must be rendered inside a `<Command>`.
 */
export function CmdkHighlightWatcher({ onHighlight }: CmdkHighlightWatcherProps) {
  const value = useCommandState((state) => state.value) as string | undefined
  const cb = useRef(onHighlight)
  // Keep the latest callback without re-firing the value effect (assigned in a
  // layout effect — refs must not be written during render).
  useLayoutEffect(() => {
    cb.current = onHighlight
  })
  useEffect(() => {
    cb.current(value)
  }, [value])
  return null
}
