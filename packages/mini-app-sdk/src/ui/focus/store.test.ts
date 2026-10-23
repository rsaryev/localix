import { beforeEach, describe, expect, test } from 'bun:test'

import {
  currentFocusEntry,
  currentKeyPolicy,
  overlayOnScreen,
  overlayOwnsKeyboard,
  useFocusStack,
} from './store'
import { DEFAULT_KEY_POLICY } from './types'

const surface = { id: 'pane', kind: 'surface' as const, keyboard: DEFAULT_KEY_POLICY.surface }
const dialog = { id: 'confirm', kind: 'dialog' as const, keyboard: DEFAULT_KEY_POLICY.dialog }
const menu = { id: 'row-menu', kind: 'menu' as const, keyboard: DEFAULT_KEY_POLICY.menu }

describe('focus stack', () => {
  beforeEach(() => useFocusStack.getState().reset())

  test('nothing claimed means every global shortcut works', () => {
    expect(currentFocusEntry()).toBeNull()
    expect(currentKeyPolicy()).toEqual(DEFAULT_KEY_POLICY.surface)
    expect(overlayOwnsKeyboard()).toBe(false)
  })

  test('the last claim wins, and unwinding restores the one underneath', () => {
    const { push, release } = useFocusStack.getState()
    push(surface)
    push(dialog)
    push(menu)

    expect(currentFocusEntry()?.id).toBe('row-menu')
    release('row-menu')
    expect(currentFocusEntry()?.id).toBe('confirm')
    release('confirm')
    expect(currentFocusEntry()?.id).toBe('pane')
  })

  test('re-claiming an id moves it up instead of duplicating it', () => {
    const { push } = useFocusStack.getState()
    push(surface)
    push(dialog)
    push(surface)

    expect(useFocusStack.getState().entries.map((entry) => entry.id)).toEqual(['confirm', 'pane'])
  })

  test('re-pushing the entry already on top does not change the stack identity', () => {
    const { push } = useFocusStack.getState()
    push(dialog)
    const before = useFocusStack.getState().entries
    push({ ...dialog })
    expect(useFocusStack.getState().entries).toBe(before)
  })

  test('releasing an id that never claimed focus is a no-op', () => {
    const { push, release } = useFocusStack.getState()
    push(surface)
    const before = useFocusStack.getState().entries
    release('never-pushed')
    expect(useFocusStack.getState().entries).toBe(before)
  })

  test('an overlay owning the keyboard suppresses plain global keys', () => {
    const { push, release } = useFocusStack.getState()
    push(surface)
    expect(currentKeyPolicy().plainKeys).toBe(true)

    push(menu)
    expect(overlayOwnsKeyboard()).toBe(true)
    expect(currentKeyPolicy()).toEqual({ plainKeys: false, modifierKeys: false })

    release('row-menu')
    expect(currentKeyPolicy().plainKeys).toBe(true)
  })

  test('an overlay under a focused field is still on screen, though it no longer owns the keys', () => {
    const { push, release } = useFocusStack.getState()
    const field = { id: 'dialog-field', kind: 'text-input' as const }
    push(surface)
    expect(overlayOnScreen(useFocusStack.getState().entries)).toBe(false)

    push(dialog)
    push({ ...field, keyboard: DEFAULT_KEY_POLICY['text-input'] })
    expect(overlayOwnsKeyboard()).toBe(false)
    expect(overlayOnScreen(useFocusStack.getState().entries)).toBe(true)

    release('confirm')
    expect(overlayOnScreen(useFocusStack.getState().entries)).toBe(false)
  })

  test('a text input tolerates a deliberate chord but never a plain key', () => {
    useFocusStack.getState().push({
      id: 'composer',
      kind: 'text-input',
      keyboard: DEFAULT_KEY_POLICY['text-input'],
    })
    expect(currentKeyPolicy()).toEqual({ plainKeys: false, modifierKeys: true })
    expect(overlayOwnsKeyboard()).toBe(false)
  })
})
