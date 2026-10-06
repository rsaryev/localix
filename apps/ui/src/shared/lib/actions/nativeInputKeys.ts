import { OS_FAMILY, type OsFamily } from '@localixai/kit/environment'
import { isPrimaryModifier, type KeyChordEvent } from '@localixai/kit/keybindings'

const EDIT_KEYS = new Set(['a', 'c', 'x', 'v', 'z', 'y'])
const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace',
  'Delete',
])
const MAC_CONTROL_KEYS = new Set([
  'a',
  'b',
  'd',
  'e',
  'f',
  'h',
  'k',
  'n',
  'o',
  'p',
  't',
  'u',
  'w',
  'y',
])

/** Browser text editing runs after bubbling, so these keys must survive workspace dispatch. */
export function nativeInputOwnsKey(
  event: KeyChordEvent,
  richText: boolean,
  os: OsFamily = OS_FAMILY,
): boolean {
  const modified = event.metaKey || event.ctrlKey || event.altKey
  if (!modified) return event.key !== 'Escape' && !/^F\d{1,2}$/u.test(event.key)
  const commandModifiers = Number(event.metaKey) + Number(event.ctrlKey) + Number(event.altKey)
  if (CARET_KEYS.has(event.key) && commandModifiers === 1) return true
  // Option-letter input on macOS produces characters; an app rebind cannot take those from a field.
  if (event.altKey && !event.metaKey && !event.ctrlKey && event.key.length === 1) return true
  const key = event.key.toLowerCase()
  if (isPrimaryModifier(event, os) && !event.altKey) {
    if (EDIT_KEYS.has(key)) return true
    if (richText && ['b', 'i', 'u'].includes(key)) return true
  }
  return (
    os === 'mac' && event.ctrlKey && !event.metaKey && !event.altKey && MAC_CONTROL_KEYS.has(key)
  )
}
