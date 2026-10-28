/**
 * Claim the keyboard for as long as a surface is active, optionally within a live DOM scope.
 *
 * Registration follows component lifetime; pane ownership also follows the key's DOM path.
 * A dialog that unmounts while a key is held, a menu
 * closed by a route change, a preview overlay torn down by its owner — all release correctly
 * without anybody remembering to.
 */
import { useEffect, useEffectEvent } from 'react'

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
  /** Live DOM root of a pane. Mounted panes must not receive another pane's keys. */
  scope?: () => Element | null
  /**
   * Keys this surface owns while it is focused. Read through an effect event, so a handler that
   * closes over fresh props does not re-push the stack on every render.
   */
  onKeyDown?: (event: KeyboardEvent) => boolean | void
}

export function useFocusEntry({
  id,
  kind,
  active = true,
  keyboard,
  scope,
  onKeyDown,
}: FocusEntryOptions): void {
  const plainKeys = keyboard?.plainKeys ?? DEFAULT_KEY_POLICY[kind].plainKeys
  const modifierKeys = keyboard?.modifierKeys ?? DEFAULT_KEY_POLICY[kind].modifierKeys

  const handleKey = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event))
  const currentScope = useEffectEvent(() => scope?.() ?? null)
  const scoped = Boolean(scope)

  useEffect(() => {
    if (!active) return
    const { push, release } = useFocusStack.getState()
    push({
      id,
      kind,
      keyboard: { plainKeys, modifierKeys },
      ...(scoped ? { scope: () => currentScope() } : {}),
      onKeyDown: (event) => handleKey(event),
    })
    return () => release(id)
  }, [id, kind, active, plainKeys, modifierKeys, scoped])
}
