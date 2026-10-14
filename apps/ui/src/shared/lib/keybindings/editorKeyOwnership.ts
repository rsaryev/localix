import { OS_FAMILY, type OsFamily } from '@localixai/kit/environment'
import { CMD } from './catalog'
import type { Chord, ShortcutCommand } from '@localixai/kit/keybindings'

/**
 * Workspace defaults captured Monaco's chord prefix and multiple-cursor keys before Monaco
 * received them. Yield only those defaults inside code input; explicit rebindings still win.
 */
export function editorOwnsDefaultBinding(
  command: ShortcutCommand,
  resolved: Chord,
  codeInputFocus: boolean,
  os: OsFamily = OS_FAMILY,
): boolean {
  if (!codeInputFocus || resolved !== command.defaultChord) return false
  if (command.id === CMD.switchSession) return true
  return os !== 'linux' && (command.id === CMD.focusNextGroup || command.id === CMD.focusPrevGroup)
}
