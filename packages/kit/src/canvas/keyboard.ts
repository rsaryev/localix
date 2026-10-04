/**
 * The camera's keyboard, as a pure mapping from a key press to a command.
 *
 * The bindings follow the usual board conventions, so they are already familiar:
 * Shift+1 fits everything, Shift+2 the selection, Shift+0 goes to
 * 100%, plus and minus step the zoom, arrows pan. Digits are read from `code`, not `key` —
 * Shift+1 types `!` on a US layout and something else on every other one.
 *
 * A key with Alt, Ctrl or ⌘ is never the camera's: those belong to the app's own shortcuts and to
 * the board's owner (the code map climbs a level on Alt+↑).
 */
import type { KeyChordEvent } from '../keyboard/chord'

export type CameraCommand =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; direction: 1 | -1 }
  | { kind: 'fit' }
  | { kind: 'fit-selection' }
  | { kind: 'actual-size' }

export type CameraKeyEvent = KeyChordEvent & { code?: string }

/** One press moves the view this far; Shift moves it a screen-ish step. */
export const PAN_STEP = { small: 80, large: 320 } as const

const PAN: Record<string, [number, number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

const SHIFT_DIGIT: Record<string, CameraCommand> = {
  Digit1: { kind: 'fit' },
  Digit2: { kind: 'fit-selection' },
  Digit0: { kind: 'actual-size' },
}

export function cameraCommand(event: CameraKeyEvent): CameraCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const pan = PAN[event.key]
  if (pan) {
    const step = event.shiftKey ? PAN_STEP.large : PAN_STEP.small
    return { kind: 'pan', dx: pan[0] * step, dy: pan[1] * step }
  }
  if (event.shiftKey && event.code && SHIFT_DIGIT[event.code]) return SHIFT_DIGIT[event.code]
  if (event.key === '=' || event.key === '+') return { kind: 'zoom', direction: 1 }
  if (event.key === '-' || event.key === '_') return { kind: 'zoom', direction: -1 }
  return null
}

/** A key typed into a control on the board is the control's, never the camera's. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  return !!element.closest(
    'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tree"], [role="grid"], [role="tablist"], [role="listbox"], [role="menu"], [role="slider"], [role="combobox"]',
  )
}

/**
 * A key pressed on a node is the node's: on an editable board the arrows nudge the selection. The
 * camera answers keys aimed at the board itself — its frame or its empty ground.
 */
export function isNodeTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  return !!element.closest('.react-flow__node, .react-flow__edge')
}

export type CanvasInteraction = 'navigate' | 'edit'

/** What assistive technology is told about the keys, after the board's own label. */
export function keyboardHelp(interaction: CanvasInteraction): string {
  const pan = interaction === 'edit' ? 'Arrow keys pan when nothing is selected' : 'Arrow keys pan'
  return `${pan}, plus and minus zoom, Shift+1 fits everything, Shift+2 the selection, Shift+0 shows 100%.`
}

/** The one-time gesture reminder; `mod` is the platform's label for its primary modifier. */
export function gestureHint(interaction: CanvasInteraction, mod: string): string {
  const zoom = `${mod} + scroll or pinch to zoom`
  return interaction === 'edit'
    ? `Drag to select · scroll or Space + drag to pan · ${zoom}`
    : `Scroll or drag to pan · ${zoom}`
}
