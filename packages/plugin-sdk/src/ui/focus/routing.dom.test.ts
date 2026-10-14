import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { currentKeyPolicy, offerKeyToFocusedSurface, useFocusStack } from './store'
import { DEFAULT_KEY_POLICY } from './types'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())
afterEach(() => useFocusStack.getState().reset())

function key(target: Element, value: string) {
  let claimed = false
  const onKey = (event: KeyboardEvent) => {
    claimed = offerKeyToFocusedSurface(event)
  }
  window.addEventListener('keydown', onKey)
  try {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    )
    return claimed
  } finally {
    window.removeEventListener('keydown', onKey)
  }
}

describe('scoped focus routing', () => {
  test('two mounted panes receive only keys from their own DOM subtree', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const first = host.appendChild(document.createElement('div'))
    const second = host.appendChild(document.createElement('div'))
    const child = first.appendChild(document.createElement('button'))
    const calls: string[] = []
    try {
      for (const [id, root] of [
        ['first', first],
        ['second', second],
      ] as const) {
        useFocusStack.getState().push({
          id,
          kind: 'surface',
          keyboard: DEFAULT_KEY_POLICY.surface,
          scope: () => root,
          onKeyDown: () => {
            calls.push(id)
            return true
          },
        })
      }
      expect(key(child, 'Enter')).toBe(true)
      expect(key(second, 'Escape')).toBe(true)
      expect(key(document.body, 'Enter')).toBe(false)
      expect(calls).toEqual(['first', 'second'])
    } finally {
      host.remove()
    }
  })

  test('nested owners run first regardless of mount order and can fall back to their parent', () => {
    const root = document.body.appendChild(document.createElement('div'))
    const child = root.appendChild(document.createElement('button'))
    const calls: string[] = []
    try {
      useFocusStack.getState().push({
        id: 'child',
        kind: 'surface',
        keyboard: DEFAULT_KEY_POLICY.surface,
        scope: () => child,
        onKeyDown: () => {
          calls.push('child')
          return false
        },
      })
      useFocusStack.getState().push({
        id: 'parent',
        kind: 'surface',
        keyboard: DEFAULT_KEY_POLICY.surface,
        scope: () => root,
        onKeyDown: () => {
          calls.push('parent')
          return true
        },
      })
      expect(key(child, 'Enter')).toBe(true)
      expect(calls).toEqual(['child', 'parent'])
    } finally {
      root.remove()
    }
  })

  test('a modal stops fallback to a pane beneath a focused field', () => {
    let behind = 0
    const { push } = useFocusStack.getState()
    push({
      id: 'pane',
      kind: 'surface',
      keyboard: DEFAULT_KEY_POLICY.surface,
      onKeyDown: () => {
        behind += 1
        return true
      },
    })
    push({ id: 'modal', kind: 'dialog', keyboard: DEFAULT_KEY_POLICY.dialog })
    push({ id: 'field', kind: 'text-input', keyboard: DEFAULT_KEY_POLICY['text-input'] })
    expect(key(document.body, 'Escape')).toBe(false)
    expect(currentKeyPolicy()).toEqual(DEFAULT_KEY_POLICY.dialog)
    expect(behind).toBe(0)
  })

  test('composition never reaches a surface handler', () => {
    let calls = 0
    useFocusStack.getState().push({
      id: 'pane',
      kind: 'surface',
      keyboard: DEFAULT_KEY_POLICY.surface,
      onKeyDown: () => {
        calls += 1
        return true
      },
    })
    expect(
      offerKeyToFocusedSurface(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })),
    ).toBe(true)
    expect(calls).toBe(0)
  })

  test('re-pushing an existing entry updates its handler', () => {
    const calls: number[] = []
    const entry = { id: 'pane', kind: 'surface' as const, keyboard: DEFAULT_KEY_POLICY.surface }
    useFocusStack.getState().push({
      ...entry,
      onKeyDown: () => {
        calls.push(1)
        return true
      },
    })
    useFocusStack.getState().push({
      ...entry,
      onKeyDown: () => {
        calls.push(2)
        return true
      },
    })
    key(document.body, 'Enter')
    expect(calls).toEqual([2])
    expect(useFocusStack.getState().entries).toHaveLength(1)
  })
})
