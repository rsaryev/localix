/**
 * A nested widget owns its double-click and keys. Letting them bubble opened the card's source
 * editor, or made the flow library move/delete the card while a tree or grid had keyboard focus.
 * `nodrag` is React Flow's existing opt-in for custom widgets; native controls need no opt-in.
 */
const CONTROLS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="grid"]',
  '.nodrag',
  '.react-flow__handle',
  '.react-flow__resize-control',
].join(', ')

export function isElementControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(CONTROLS))
}

/**
 * A host-rendered control may not know it is inside a draggable card. Mark its own hit target
 * before XYDrag's native bubbling listener checks it; keep its pointer handlers and defaults.
 * This uses the library's existing classes without scanning content or observing DOM mutations.
 */
export function protectControlDrag(target: EventTarget | null) {
  if (target instanceof Element) target.closest(CONTROLS)?.classList.add('nodrag', 'nopan')
}

/**
 * Native input/change follows click. A capture-phase state update (even a microtask between
 * browser event listeners) can replace that input before it writes. Frame it in the next task.
 * Coalesce repeated clicks and cancel on unmount so a closed card cannot refocus the board.
 */
export function useControlFocus(focus: () => void) {
  const latest = useLatest(focus)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current)
    },
    [],
  )
  return () => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      pending.current = null
      latest.current()
    }, 0)
  }
}
import { useEffect, useRef } from 'react'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
