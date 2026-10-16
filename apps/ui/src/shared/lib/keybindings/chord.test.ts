import { describe, expect, it } from 'bun:test'
import {
  canonicalizeChord,
  chordFromEvent,
  matchesChord,
  formatChordText,
  formatModifierText,
  isPrimaryModifier,
  withChordHint,
  type KeyChordEvent,
} from '@localixai/kit/keybindings'
import { resolveBindings, findConflicts } from './resolve'
import { CMD } from './catalog'

function ev(partial: Partial<KeyChordEvent>): KeyChordEvent {
  return { key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...partial }
}

describe('chordFromEvent', () => {
  it('records the native primary modifier as portable mod', () => {
    expect(chordFromEvent(ev({ key: 'p', metaKey: true }), 'mac')).toBe('mod+p')
    expect(chordFromEvent(ev({ key: 'O', metaKey: true, shiftKey: true }), 'mac')).toBe(
      'mod+shift+o',
    )
    expect(chordFromEvent(ev({ key: 'ArrowLeft', ctrlKey: true, altKey: true }), 'windows')).toBe(
      'mod+alt+arrowleft',
    )
  })
  it('records the other command modifier as portable secondary', () => {
    expect(chordFromEvent(ev({ key: 'k', ctrlKey: true }), 'mac')).toBe('secondary+k')
    expect(chordFromEvent(ev({ key: 'k', metaKey: true }), 'windows')).toBe('secondary+k')
    expect(chordFromEvent(ev({ key: 'k', metaKey: true }), 'linux')).toBe('secondary+k')
    expect(chordFromEvent(ev({ key: 'k', ctrlKey: true, metaKey: true }), 'mac')).toBe(
      'mod+secondary+k',
    )
    expect(chordFromEvent(ev({ key: 'k', ctrlKey: true, metaKey: true }), 'windows')).toBe(
      'mod+secondary+k',
    )
  })
  it('returns null for a bare modifier press', () => {
    expect(chordFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull()
    expect(chordFromEvent(ev({ key: 'Meta', metaKey: true }))).toBeNull()
  })
  it('normalizes space and unmodified keys', () => {
    expect(chordFromEvent(ev({ key: ' ' }))).toBe('space')
    expect(chordFromEvent(ev({ key: 'F2' }))).toBe('f2')
  })
})

describe('matchesChord', () => {
  it('matches mod against Command on macOS and Ctrl on Windows/Linux only', () => {
    expect(matchesChord(ev({ key: 'p', metaKey: true }), 'mod+p', 'mac')).toBe(true)
    expect(matchesChord(ev({ key: 'p', ctrlKey: true }), 'mod+p', 'mac')).toBe(false)
    expect(matchesChord(ev({ key: 'p', ctrlKey: true }), 'mod+p', 'windows')).toBe(true)
    expect(matchesChord(ev({ key: 'p', metaKey: true }), 'mod+p', 'windows')).toBe(false)
    expect(matchesChord(ev({ key: 'p', ctrlKey: true }), 'mod+p', 'linux')).toBe(true)
  })
  it('maps secondary to Control on macOS and Meta elsewhere', () => {
    expect(matchesChord(ev({ key: 'p', ctrlKey: true }), 'secondary+p', 'mac')).toBe(true)
    expect(matchesChord(ev({ key: 'p', metaKey: true }), 'secondary+p', 'windows')).toBe(true)
    expect(matchesChord(ev({ key: 'p', metaKey: true }), 'secondary+p', 'linux')).toBe(true)
    expect(
      matchesChord(ev({ key: 'p', ctrlKey: true, metaKey: true }), 'mod+secondary+p', 'windows'),
    ).toBe(true)
  })
  it('rejects when modifiers differ', () => {
    expect(matchesChord(ev({ key: 'p' }), 'mod+p', 'mac')).toBe(false)
    expect(matchesChord(ev({ key: 'p', metaKey: true, shiftKey: true }), 'mod+p', 'mac')).toBe(
      false,
    )
  })
  it('never matches an unassigned (null) chord', () => {
    expect(matchesChord(ev({ key: 'Escape' }), null)).toBe(false)
  })
})

describe('isPrimaryModifier', () => {
  it('does not confuse macOS Control or Windows Meta with the primary accelerator', () => {
    expect(isPrimaryModifier(ev({ metaKey: true }), 'mac')).toBe(true)
    expect(isPrimaryModifier(ev({ ctrlKey: true }), 'mac')).toBe(false)
    expect(isPrimaryModifier(ev({ ctrlKey: true }), 'windows')).toBe(true)
    expect(isPrimaryModifier(ev({ metaKey: true }), 'windows')).toBe(false)
  })

  it('rejects a combined Ctrl+Meta gesture as a plain primary modifier', () => {
    expect(isPrimaryModifier(ev({ ctrlKey: true, metaKey: true }), 'mac')).toBe(false)
    expect(isPrimaryModifier(ev({ ctrlKey: true, metaKey: true }), 'windows')).toBe(false)
  })
})

describe('canonicalizeChord', () => {
  it('reorders modifiers and lowercases', () => {
    expect(canonicalizeChord('Shift+Secondary+Mod+O')).toBe('mod+secondary+shift+o')
  })
  it('rejects modifier-only input', () => {
    expect(canonicalizeChord('mod+shift')).toBeNull()
    expect(canonicalizeChord(null)).toBeNull()
  })
  it('rejects unknown and duplicated modifier tokens', () => {
    expect(canonicalizeChord('hyper+p')).toBeNull()
    expect(canonicalizeChord('mod+mod+p')).toBeNull()
  })
})

describe('formatChordText', () => {
  it('uses native modifier names and separators on every OS family', () => {
    expect(formatChordText('mod+shift+o', 'mac')).toBe('⌘⇧O')
    expect(formatChordText('mod+shift+o', 'windows')).toBe('Ctrl+Shift+O')
    expect(formatChordText('mod+shift+o', 'linux')).toBe('Ctrl+Shift+O')
    expect(formatChordText('secondary+k', 'windows')).toBe('Win+K')
    expect(formatChordText('secondary+k', 'linux')).toBe('Super+K')
    expect(formatChordText('secondary+k', 'mac')).toBe('⌃K')
  })
  it('renders a modifier-less chord', () => {
    expect(formatChordText('f2')).toBe('F2')
  })
  it('is empty for an unassigned chord (so callers can skip the hint)', () => {
    expect(formatChordText(null)).toBe('')
  })
})

describe('formatModifierText', () => {
  it('labels non-key pointer modifiers natively', () => {
    expect(formatModifierText('alt', 'mac')).toBe('⌥')
    expect(formatModifierText('alt', 'windows')).toBe('Alt')
    expect(formatModifierText('secondary', 'windows')).toBe('Win')
    expect(formatModifierText('secondary', 'linux')).toBe('Super')
  })
})

describe('withChordHint', () => {
  it('appends the chord in parentheses', () => {
    expect(withChordHint('Terminal', 'mod+`', 'mac')).toBe('Terminal (⌘`)')
    expect(withChordHint('Terminal', 'mod+`', 'windows')).toBe('Terminal (Ctrl+`)')
  })
  it('leaves the title untouched when unbound (no empty parens)', () => {
    expect(withChordHint('Terminal', null)).toBe('Terminal')
  })
})

describe('resolveBindings', () => {
  it('uses catalog defaults with no overrides', () => {
    const resolved = resolveBindings(undefined)
    expect(resolved[CMD.goToFile]).toBe('mod+p')
  })
  it('lets an override win, including explicit unassign', () => {
    const resolved = resolveBindings({ [CMD.goToFile]: 'mod+shift+e', [CMD.switchSession]: null })
    expect(resolved[CMD.goToFile]).toBe('mod+shift+e')
    expect(resolved[CMD.switchSession]).toBeNull()
  })
  it('ignores overrides for non-configurable commands', () => {
    const resolved = resolveBindings({ [CMD.sendMessage]: 'mod+x' })
    expect(resolved[CMD.sendMessage]).toBe('enter')
  })
})

describe('findConflicts', () => {
  it('flags same-category collisions but not cross-category', () => {
    // A chord shared across CATEGORIES is not a conflict — the two commands can never be live at
    // once. Constructed rather than taken from the catalog, whose one accidental cross-category
    // pair was a source-control command that has since left core.
    const clean = findConflicts(resolveBindings({ [CMD.newChat]: 'mod+enter' }))
    expect(clean.has(CMD.newChat)).toBe(false)
    expect(clean.has(CMD.submitMessageEdit)).toBe(false)
    // Two navigation commands sharing a chord IS a conflict.
    const conflicted = resolveBindings({ [CMD.switchSession]: 'mod+p' })
    const set = findConflicts(conflicted)
    expect(set.has(CMD.switchSession)).toBe(true)
    expect(set.has(CMD.goToFile)).toBe(true)
  })
})
