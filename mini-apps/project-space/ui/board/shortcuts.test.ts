import { describe, expect, test } from 'bun:test'
import type { KeyboardEvent } from 'react'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { INSERTABLE } from '../elements'
import { boardKeyHandler, type BoardKeyDeps } from './boardKeys'
import { boardShortcuts } from './shortcuts'

/**
 * The shortcuts sheet is a promise: every row says a key does something. Each row's chords are
 * pressed against the real handler, on a board where the row can apply, and must be taken. A row
 * left behind by a changed binding fails here instead of lying on the sheet; the control at the
 * end proves the harness can fail.
 */
const space = applyOps(
  emptySpace(),
  [
    { op: 'create', type: 'note', id: 'a', x: 0, y: 0 },
    { op: 'create', type: 'note', id: 'b', x: 300, y: 0 },
    { op: 'create', type: 'note', id: 'c', x: 600, y: 40 },
  ],
  { registry: spaceTypes },
).space

const MOD = isPrimaryModifier({ metaKey: true, ctrlKey: false }) ? 'metaKey' : 'ctrlKey'
const TOOL_KEYS = new Set([
  'v',
  'h',
  'q',
  'escape',
  ...INSERTABLE.flatMap((v) => v.insert?.key ?? []),
])

function press(chord: string): KeyboardEvent<HTMLDivElement> {
  const parts = chord.split('+')
  const key = parts.at(-1) === '' ? '+' : (parts.at(-1) as string)
  const has = (token: string) => parts.slice(0, -1).includes(token)
  const code = /^[a-z]$/u.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/u.test(key)
      ? `Digit${key}`
      : (({ '/': 'Slash', ']': 'BracketRight', '[': 'BracketLeft' } as Record<string, string>)[
          key
        ] ?? '')
  const named = key.length > 1 ? key.charAt(0).toUpperCase() + key.slice(1) : key
  return {
    key: named.replace(/^Arrow(\w)/u, (_, c: string) => `Arrow${c.toUpperCase()}`),
    code,
    shiftKey: has('shift'),
    altKey: has('alt'),
    metaKey: MOD === 'metaKey' && has('mod'),
    ctrlKey: MOD === 'ctrlKey' && has('mod'),
  } as unknown as KeyboardEvent<HTMLDivElement>
}

function handles(chord: string, selected: readonly string[]): boolean {
  const deps: BoardKeyDeps = {
    space,
    selected: new Set(selected),
    entered: null,
    select: () => undefined,
    focus: () => undefined,
    enterGroup: () => true,
    leaveGroup: () => false,
    commit: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    setEditing: () => undefined,
    onToolKey: (key) => TOOL_KEYS.has(key),
    toggleLayers: () => undefined,
    openFind: () => undefined,
    openShortcuts: () => undefined,
    clearTrace: () => true,
    camera: { back: () => true, forward: () => true, toSelection: () => true },
    grow: () => undefined,
    style: { copied: () => ({ color: 'red' }), copy: () => undefined },
    presentation: { active: false, index: 0, go: () => undefined, stop: () => undefined },
  }
  return boardKeyHandler(deps)(press(chord))
}

describe('the shortcuts sheet', () => {
  const rows = boardShortcuts().flatMap((group) =>
    group.shortcuts.flatMap((shortcut) =>
      shortcut.keys.map((chord) => [group.title, chord] as const),
    ),
  )

  test.each(rows)('%s: %s is answered by the board', (_group, chord) => {
    // One element for what acts on one (⌘ + arrow), three for what needs several (distribute).
    expect(handles(chord, ['a']) || handles(chord, ['a', 'b', 'c'])).toBe(true)
  })

  test('a key the board does not answer is caught (the harness can fail)', () => {
    expect(handles('alt+z', ['a', 'b', 'c'])).toBe(false)
  })

  test('the slash key finds and, with Shift, opens the sheet — on any layout', () => {
    const opened: string[] = []
    const deps = {
      space,
      selected: new Set<string>(),
      openFind: () => opened.push('find'),
      openShortcuts: () => opened.push('sheet'),
    } as unknown as BoardKeyDeps
    const handler = boardKeyHandler(deps)
    handler(press('/'))
    handler(press('shift+/'))
    // A Russian layout's key there types "." — the key is read by position.
    handler({ ...press('/'), key: '.' })
    expect(opened).toEqual(['find', 'sheet', 'find'])
  })
})
