/**
 * Claim the keyboard for as long as a surface is up.
 *
 * The claim is tied to the component's lifetime, not to a DOM event, because that is the thing that
 * actually matches "this surface is on screen". A dialog that unmounts while a key is held, a menu
 * closed by a route change, a preview overlay torn down by its owner — all release correctly
 * without anybody remembering to.
 */
import { useEffect, useRef } from 'react'

import { useFocusStack } from './store'
import { DEFAULT_KEY_POLICY, type FocusKind, type GlobalKeyPolicy } from './types'

export interface FocusEntryOptions {
  /** Stable per surface. Re-focusing the same id moves the claim up rather than duplicating it. */
  id: string
  kind: FocusKind
  /** Claim only while true. A surface that renders before it is interactive passes its own flag. */
  active?: boolean
  /** Override the kind's default policy. Reach for this only with a reason. */
  keyboard?: Partial<GlobalKeyPolicy>
  /**
   * Keys this surface owns while it is focused. Kept in a ref, so a handler that closes over fresh
   * props does not re-push the stack on every render.
   */
  onKeyDown?: (event: KeyboardEvent) => boolean | void
}

export function useFocusEntry({
  id,
  kind,
  active = true,
  keyboard,
  onKeyDown,
}: FocusEntryOptions): void {
  const plainKeys = keyboard?.plainKeys ?? DEFAULT_KEY_POLICY[kind].plainKeys
  const modifierKeys = keyboard?.modifierKeys ?? DEFAULT_KEY_POLICY[kind].modifierKeys

  const handlerRef = useRef(onKeyDown)
  handlerRef.current = onKeyDown

  useEffect(() => {
    if (!active) return
    const { push, release } = useFocusStack.getState()
    push({
      id,
      kind,
      keyboard: { plainKeys, modifierKeys },
      onKeyDown: (event) => handlerRef.current?.(event),
    })
    return () => release(id)
  }, [id, kind, active, plainKeys, modifierKeys])
}
