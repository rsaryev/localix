// A double-click on the title row does what System Settings says (Zoom, Minimize or nothing).
//
// Tauri's drag script (tauri 2.11 `window/scripts/drag.js`) answers a double-click on a
// `data-tauri-drag-region` with `plugin:window|internal_toggle_maximize`, on mouseup and only when
// the pointer did not move, and never reads `AppleActionOnDoubleClick`. Its listener sits on the
// document, so this one, on the window in the capture phase, takes the same gesture first and
// hands it to the shell (`titlebar_double_click.rs`), which reads the setting.

import type { InvokeFn } from './tauri'

const ATTR = 'data-tauri-drag-region'
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'])
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
])

function isClickable(el: HTMLElement): boolean {
  const editable = el.getAttribute('contenteditable')
  const tabindex = el.getAttribute('tabindex')
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (editable !== null && editable !== 'false') ||
    (tabindex !== null && tabindex !== '-1') ||
    INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '')
  )
}

/** Tauri's own rule for "this press is on a drag region", so both agree on every element. */
function isDragRegion(path: readonly EventTarget[]): boolean {
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue
    const attr = el.getAttribute(ATTR)
    if (attr === null) {
      if (isClickable(el)) return false
      continue
    }
    if (attr === 'false') return false
    if (attr === 'deep') return true
    if (attr === '' || attr === 'true') return el === path[0]
  }
  return false
}

/** Take the title row's double-click from Tauri. Returns the uninstall. */
export function installTitlebarDoubleClick(target: Window, invoke: InvokeFn): () => void {
  let pressedAt: { x: number; y: number } | null = null
  const onDown = (event: MouseEvent) => {
    pressedAt = event.detail === 2 ? { x: event.clientX, y: event.clientY } : null
  }
  const onUp = (event: MouseEvent) => {
    const still = pressedAt?.x === event.clientX && pressedAt.y === event.clientY
    pressedAt = null
    if (event.button !== 0 || event.detail !== 2 || !still) return
    if (!isDragRegion(event.composedPath())) return
    event.stopImmediatePropagation()
    void invoke('titlebar_double_click').catch(() => {})
  }
  target.addEventListener('mousedown', onDown, true)
  target.addEventListener('mouseup', onUp, true)
  return () => {
    target.removeEventListener('mousedown', onDown, true)
    target.removeEventListener('mouseup', onUp, true)
  }
}
