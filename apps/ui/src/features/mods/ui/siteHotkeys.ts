import type { KeyboardEvent } from 'react'
import type { ModAction, ModElement } from '@/shared/api/modsApi'

/**
 * A drawn site's hotkeys, as Claude Code keys them: a Button's `hotkey` — one digit or one
 * lowercase letter — presses it while its site (a pane, the band) holds the focus; Shift with the
 * letter is the letter; two Buttons on one hotkey, the later drawn gets it. While a field of the
 * site holds the focus, every printable key is the field's.
 */

const HOTKEY = /^[0-9a-z]$/

/** Each hotkey of the drawing, to the key of the Button it presses. */
export function hotkeysOf(nodes: ReadonlyArray<ModElement | string>): Map<string, string> {
  const keys = new Map<string, string>()
  const visit = (node: ModElement | string) => {
    if (typeof node === 'string') return
    const { hotkey, key } = node.props
    if (node.type === 'Button' && typeof hotkey === 'string' && HOTKEY.test(hotkey))
      keys.set(hotkey, typeof key === 'string' ? key : '')
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return keys
}

const isField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** The site's key handler: a hotkey presses its Button; true when it did. */
export function pressHotkey(
  event: Pick<
    KeyboardEvent,
    'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'preventDefault'
  >,
  hotkeys: ReadonlyMap<string, string>,
  act: (action: ModAction) => void,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || isField(event.target)) return false
  const element = hotkeys.get(event.key.toLowerCase())
  if (!element) return false
  event.preventDefault()
  act({ kind: 'press', element })
  return true
}
