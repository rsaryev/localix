/**
 * Claim the keyboard for an overlay, for exactly as long as its content is on screen.
 *
 * The defect this shape stops: the claim used to be a bare hook call in the shared content
 * components, on the belief that content mounts only while its overlay is open. The Radix content
 * PRIMITIVE does — Presence mounts it — but the wrapper that called the hook is rendered by its
 * Root whether the overlay is open or not. So every closed dialog, drawer, menu and popover sat on
 * the stack for as long as its trigger was mounted: a model picker opened once kept a `dialog`
 * claim forever, `overlayOwnsKeyboard()` answered for overlays nobody could see, and the desktop
 * browser page read the permanent claim as "an overlay covers me".
 *
 * So the claim is a callback ref for the content element itself. It is pushed when that element
 * attaches and released when it detaches, and the element's lifetime IS "on screen" — exit
 * animation included — with no open-state bookkeeping and no DOM query.
 *
 * A ref rather than a rendered component, because these primitives wrap Radix, and Radix slots its
 * children: a null-rendering sibling node inside a Portal is not free there, it makes the tree fail
 * `Expected a single React element child`. A ref adds nothing to the tree at all.
 */
import { useCallback, useId, type Ref, type RefCallback } from 'react'

import { useFocusStack } from './store'
import { DEFAULT_KEY_POLICY, type FocusKind } from './types'

type OverlayKind = Extract<FocusKind, 'dialog' | 'menu' | 'overlay'>

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/**
 * The ref to put on one overlay's content element. `forwardedRef` is the caller's own ref for that
 * element; it receives the node as if it had been attached directly. The id is per instance, so a
 * menu opened inside a dialog stacks above it and unwinds back to it.
 */
export function useOverlayFocus<T extends Element>(
  kind: OverlayKind,
  forwardedRef?: Ref<T>,
): RefCallback<T> {
  const id = `${kind}:${useId()}`
  const claim = useCallback(
    (node: T | null) => {
      const { push, release } = useFocusStack.getState()
      if (node) push({ id, kind, keyboard: DEFAULT_KEY_POLICY[kind] })
      else release(id)
    },
    [id, kind],
  )
  // Composed the way React composes any two refs: a caller's ref that changes identity is handed
  // the node again, and the claim is re-pushed with it — the same single entry, moved to the top
  // exactly as a re-focus moves it.
  return useCallback(
    (node: T | null) => {
      claim(node)
      assignRef(forwardedRef, node)
    },
    [claim, forwardedRef],
  )
}
