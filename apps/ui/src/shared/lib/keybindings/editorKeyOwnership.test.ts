import { describe, expect, test } from 'bun:test'
import { CMD, SHORTCUT_CATALOG } from './catalog'
import { editorOwnsDefaultBinding } from './editorKeyOwnership'

const command = (id: string) => SHORTCUT_CATALOG.find((entry) => entry.id === id)!

describe('Monaco and workspace shortcut ownership', () => {
  test('Monaco keeps Cmd/Ctrl+K for multi-stroke editor commands', () => {
    for (const os of ['mac', 'windows', 'linux'] as const) {
      expect(editorOwnsDefaultBinding(command(CMD.switchSession), 'mod+k', true, os)).toBe(true)
    }
  })

  test('Monaco keeps add-cursor keys on macOS and Windows', () => {
    for (const id of [CMD.focusNextGroup, CMD.focusPrevGroup]) {
      const entry = command(id)
      for (const os of ['mac', 'windows'] as const) {
        expect(editorOwnsDefaultBinding(entry, entry.defaultChord, true, os)).toBe(true)
      }
      // Linux's add-cursor binding is Shift+Alt+Up/Down, so no default collides there.
      expect(editorOwnsDefaultBinding(entry, entry.defaultChord, true, 'linux')).toBe(false)
    }
  })

  test('the defaults remain workspace commands outside code input', () => {
    for (const id of [CMD.switchSession, CMD.focusNextGroup, CMD.focusPrevGroup]) {
      const entry = command(id)
      expect(editorOwnsDefaultBinding(entry, entry.defaultChord, false, 'mac')).toBe(false)
    }
  })

  test('explicit rebindings and unbound commands are respected', () => {
    expect(editorOwnsDefaultBinding(command(CMD.switchSession), 'mod+e', true, 'mac')).toBe(false)
    expect(editorOwnsDefaultBinding(command(CMD.focusNextGroup), 'mod+9', true, 'mac')).toBe(false)
    expect(editorOwnsDefaultBinding(command(CMD.switchSession), null, true, 'mac')).toBe(false)
  })

  test('unrelated workspace commands still run while typing code', () => {
    for (const id of [CMD.goToFile, CMD.commandPalette, CMD.toggleSidebar]) {
      const entry = command(id)
      expect(editorOwnsDefaultBinding(entry, entry.defaultChord, true, 'mac')).toBe(false)
    }
  })
})
