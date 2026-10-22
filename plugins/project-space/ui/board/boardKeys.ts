import type { KeyboardEvent } from 'react'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import type { SpaceDocument } from '../../shared/format/document'
import type { AlignEdge, SpaceOp } from '../../shared/ops/contract'
import { readingOrder } from '../../shared/ops/layout'
import { spaceTypes } from '../../shared/types'
import { duplicateOps } from '../content/clipboard'
import { viewOf } from '../elements'
import { frameSelection } from './frameSelection'
import type { Presentation } from './usePresentation'
import {
  alignOps,
  distributeOps,
  groupOps,
  lockOps,
  pasteStyleOps,
  stackOps,
  styleOf,
  ungroupOps,
  type CopiedStyle,
  type Selected,
} from './commands'
import { nudgeOps } from './moves'

/**
 * The board's own keys, asked before the camera's (`Canvas.onBoardKey`) and never for a key typed
 * into a field. The bindings follow the common design-tool conventions, and their list is
 * `shortcuts.ts` — the sheet a person opens with `?`, held to this handler by
 * `shortcuts.test.ts`.
 *
 * Escape lets go of one thing at a time, the most temporary first: the armed tool, then a trace,
 * then the entered group, then the selection.
 *
 * Keys are matched by their PHYSICAL position (`event.code`): on a non-Latin layout `event.key`
 * for N is that layout's letter, and on macOS ⌥A types "å" — the letter never arrives, the key
 * always does.
 */
export interface BoardKeyDeps {
  space: SpaceDocument
  selected: ReadonlySet<string>
  entered: string | null
  select: (ids: Iterable<string>) => void
  /** Select as a deliberate focus: the camera goes there. */
  focus: (ids: Iterable<string>) => void
  /** Reach one level into the selected group, or back out of the entered one. */
  enterGroup: () => boolean
  leaveGroup: () => boolean
  commit: (ops: readonly SpaceOp[]) => void
  undo: () => void
  redo: () => void
  setEditing: (id: string | null) => void
  /** A plain letter (or Escape) for the tools; true when a tool took it. */
  onToolKey: (key: string) => boolean
  toggleLayers: () => void
  /** `/`: find an element; `?`: the shortcuts sheet. */
  openFind: () => void
  openShortcuts: () => void
  /** Escape's second step: end the trace on screen; false when there is none. */
  clearTrace: () => boolean
  /** The camera's history and "zoom to selection" (`camera/useBoardCamera.ts`). */
  camera: {
    back: () => boolean
    forward: () => boolean
    toSelection: () => boolean
  }
  /** ⌘/Ctrl + arrow: a connected twin of the one selected element on that side. */
  grow: (id: string, side: 'top' | 'right' | 'bottom' | 'left') => void
  /** The style ⌥⌘C copied, for ⌥⌘V: kept for the board's life, like the design tools'. */
  style: StyleClipboard
  /** While presenting, the keys walk the slides and nothing else edits the board. */
  presentation?: Pick<Presentation, 'active' | 'index' | 'go' | 'stop'>
}

export interface StyleClipboard {
  copied: () => CopiedStyle | null
  copy: (style: CopiedStyle) => void
}

const ARROWS: Record<
  string,
  { side: 'top' | 'right' | 'bottom' | 'left'; dx: number; dy: number }
> = {
  arrowup: { side: 'top', dx: 0, dy: -1 },
  arrowright: { side: 'right', dx: 1, dy: 0 },
  arrowdown: { side: 'bottom', dx: 0, dy: 1 },
  arrowleft: { side: 'left', dx: -1, dy: 0 },
}
const ALIGN: Record<string, AlignEdge> = {
  a: 'left',
  h: 'center',
  d: 'right',
  w: 'top',
  v: 'middle',
  s: 'bottom',
}
const NUDGE = 1
const NUDGE_FAR = 10

/** The key as its physical position names it: `KeyN` → n, `BracketRight` → ], else the key. */
export function physicalKey(event: { code: string; key: string }): string {
  const letter = /^Key([A-Z])$/u.exec(event.code)
  if (letter) return (letter[1] as string).toLowerCase()
  const digit = /^Digit(\d)$/u.exec(event.code)
  if (digit) return digit[1] as string
  if (event.code === 'BracketRight') return ']'
  if (event.code === 'BracketLeft') return '['
  // The key right of the full stop: "." on a Russian layout, "/" and, with Shift, "?" on a US one.
  if (event.code === 'Slash') return '/'
  return event.key.toLowerCase()
}

export function boardKeyHandler(deps: BoardKeyDeps) {
  return (event: KeyboardEvent<HTMLDivElement>): boolean => {
    const mod = isPrimaryModifier(event)
    const key = physicalKey(event)
    const ids = [...deps.selected].filter((id) => deps.space.elements[id])
    const selection: Selected = { space: deps.space, ids, entered: deps.entered }
    const run = (ops: SpaceOp[] | null) => {
      if (ops) deps.commit(ops)
      return true
    }
    if (deps.presentation?.active) {
      const { index, go, stop } = deps.presentation
      if (['arrowright', 'arrowdown', 'pagedown', ' '].includes(key)) go(index + 1)
      else if (['arrowleft', 'arrowup', 'pageup'].includes(key)) go(index - 1)
      else if (key === 'escape') stop()
      // A slide is not edited: every other key is swallowed rather than acting on the board.
      return true
    }

    if ((key === 'delete' || key === 'backspace') && !mod && deps.selected.size) {
      const gone = [...deps.selected].filter((id) => !deps.space.elements[id]?.locked)
      deps.commit(gone.map((id) => ({ op: 'delete', id })))
      deps.select([])
      return true
    }
    if (mod && key === 'z') {
      if (event.shiftKey) deps.redo()
      else deps.undo()
      return true
    }
    if (mod && key === 'y') {
      deps.redo()
      return true
    }
    if (mod && key === 'd' && ids.length) return run(duplicateOps(deps.space, ids))
    if (mod && key === 'a') {
      deps.select(
        Object.entries(deps.space.elements)
          .filter(([, element]) => !element.locked)
          .map(([id]) => id),
      )
      return true
    }
    // ⌥ with ⌘: style and frame, asked before ⌘G alone would group.
    if (mod && event.altKey && !event.shiftKey && ids.length) {
      if (key === 'c' && ids.length === 1) {
        const style = styleOf(deps.space, ids[0] as string)
        if (style) deps.style.copy(style)
        return true
      }
      if (key === 'v') {
        const style = deps.style.copied()
        return run(style ? pasteStyleOps(selection, style) : null)
      }
      if (key === 'g') {
        frameSelection(deps, ids)
        return true
      }
    }
    if (mod && key === 'g' && ids.length)
      return run((event.shiftKey ? ungroupOps : groupOps)(selection))
    if (mod && (key === ']' || key === '[') && ids.length) {
      const far = event.altKey || event.shiftKey
      return run(
        stackOps(selection, key === ']' ? (far ? 'front' : 'forward') : far ? 'back' : 'backward'),
      )
    }
    if (mod && event.shiftKey && key === 'l' && ids.length) return run(lockOps(selection))
    if (event.altKey && !mod && ids.length) {
      if (event.shiftKey && (key === 'h' || key === 'v'))
        return run(distributeOps(selection, key === 'h' ? 'horizontal' : 'vertical'))
      if (!event.shiftKey && ALIGN[key]) return run(alignOps(selection, ALIGN[key]))
    }

    // Tab moves the focus to the next element in reading order (Shift+Tab, the one before); the
    // camera follows the focus (`camera/useFollowFocus.ts`), so this walks a board by keyboard.
    if (key === 'tab' && !mod && !event.altKey) {
      const order = Object.entries(deps.space.elements)
        .filter(([, element]) => !element.locked)
        .sort(([, a], [, b]) => readingOrder(a, b))
        .map(([id]) => id)
      if (order.length === 0) return false
      const at = ids.length === 1 ? order.indexOf(ids[0] as string) : -1
      const step = event.shiftKey ? -1 : 1
      const next =
        at < 0 ? (event.shiftKey ? order.length - 1 : 0) : (at + step + order.length) % order.length
      deps.focus([order[next] as string])
      return true
    }
    // The camera's way back and forward after a jump, and the two-step zoom to selection.
    if (event.altKey && !mod && !event.shiftKey && (key === 'arrowleft' || key === 'arrowright'))
      return key === 'arrowleft' ? deps.camera.back() : deps.camera.forward()
    if (event.shiftKey && !mod && !event.altKey && key === '2' && deps.camera.toSelection())
      return true

    const arrow = ARROWS[key]
    if (arrow && mod && ids.length === 1) {
      deps.grow(ids[0] as string, arrow.side)
      return true
    }
    if (arrow && !mod && !event.altKey && ids.length) {
      const step = event.shiftKey ? NUDGE_FAR : NUDGE
      return run(nudgeOps(deps.space, ids, arrow.dx * step, arrow.dy * step, spaceTypes))
    }

    if (key === 'enter' && !mod) {
      if (deps.enterGroup()) return true
      const element = ids.length === 1 ? deps.space.elements[ids[0] as string] : undefined
      if (element && !element.locked && viewOf(element.type)?.editable) {
        deps.setEditing(ids[0] as string)
        return true
      }
    }
    const plain = !mod && !event.altKey && !event.shiftKey
    if (plain && key === 'l') {
      deps.toggleLayers()
      return true
    }
    // A "?" that is not on the slash key (a German layout's Shift+ß) opens the sheet too.
    if ((key === '/' || key === '?') && !mod && !event.altKey) {
      if (event.shiftKey || key === '?') deps.openShortcuts()
      else deps.openFind()
      return true
    }
    if (plain && deps.onToolKey(key)) return true
    if (key === 'escape') {
      if (deps.clearTrace()) return true
      if (deps.leaveGroup()) return true
      if (deps.selected.size) {
        deps.select([])
        return true
      }
    }
    return false
  }
}
