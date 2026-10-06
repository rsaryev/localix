import { afterEach, describe, expect, test } from 'bun:test'

import type { ActionContext } from './context'
import { evaluateActionWhen } from './context'
import { clearActionHandlers, executeAction, registerActionHandler } from './registry'

const context: ActionContext = {
  inputFocus: false,
  hasSelection: false,
  menuOpen: false,
  chatFocus: false,
  editorFocus: true,
  sidebarFocus: false,
}

afterEach(clearActionHandlers)

describe('action context conditions', () => {
  test('supports negation, AND, and OR with unknown keys closed', () => {
    expect(evaluateActionWhen('editorFocus && !inputFocus', context)).toBe(true)
    expect(evaluateActionWhen('chatFocus || editorFocus', context)).toBe(true)
    expect(evaluateActionWhen('unknownKey', context)).toBe(false)
    expect(evaluateActionWhen('!unknownKey', context)).toBe(false)
  })
})

describe('action registry', () => {
  test('newest enabled handler wins and cleanup restores the previous handler', () => {
    const calls: string[] = []
    registerActionHandler({ commandId: 'test.open', run: () => calls.push('base') })
    const removeScoped = registerActionHandler({
      commandId: 'test.open',
      run: () => calls.push('scoped'),
      when: 'editorFocus',
    })

    expect(executeAction('test.open', context)).toBe(true)
    removeScoped()
    expect(executeAction('test.open', context)).toBe(true)
    expect(calls).toEqual(['scoped', 'base'])
  })

  test('catalog and handler conditions both have to pass', () => {
    let calls = 0
    registerActionHandler({
      commandId: 'test.open',
      run: () => {
        calls += 1
      },
      when: 'editorFocus',
    })
    expect(executeAction('test.open', context, '!menuOpen')).toBe(true)
    expect(executeAction('test.open', { ...context, menuOpen: true }, '!menuOpen')).toBe(false)
    expect(calls).toBe(1)
  })
})
