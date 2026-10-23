import { afterEach, expect, spyOn, test } from 'bun:test'
import { pluginUiHostFor, removePluginUiContributions } from './host'
import { setEnabledPluginNames } from './pluginActivation'
import { actionMatches, contributedActions } from './actions'
import type { ActionContext, ActionContribution } from '@localixai/mini-app-sdk/ui'

const owner = 'visual-fixture'
test('predicates filter typed targets and fail closed without breaking content', () => {
  const context: ActionContext = {
    sessionId: 's',
    surface: 'chat.content',
    target: { kind: 'code', text: 'hello' },
  }
  const action: ActionContribution = {
    id: 'test:save',
    label: 'Save',
    Icon: () => null,
    when: (context) => context.target.kind === 'code',
    run: async () => {},
  }
  expect(actionMatches(action, context)).toBe(true)
  expect(
    actionMatches(action, { ...context, target: { kind: 'link', url: 'https://example.com' } }),
  ).toBe(false)
  expect(
    actionMatches(
      {
        ...action,
        when: () => {
          throw new Error('bad plugin')
        },
      },
      context,
    ),
  ).toBe(false)
  const asyncAction = { ...action, when: async () => true } as unknown as ActionContribution
  expect(actionMatches(asyncAction, context)).toBe(false)
})
afterEach(() => {
  removePluginUiContributions(owner)
  setEnabledPluginNames(null)
})

test('owned actions follow plugin activation and disappear on unload', () => {
  const host = pluginUiHostFor(owner)
  const action = {
    id: `${owner}:save`,
    label: 'Save',
    Icon: () => null,
    when: () => true,
    run: async () => {},
  }
  host.actions!.register(action)
  expect(contributedActions()).toEqual([])
  setEnabledPluginNames(new Set([owner]))
  expect(contributedActions()[0]).toMatchObject({ ...action, pluginName: owner })
  expect(contributedActions()).toBe(contributedActions())
  setEnabledPluginNames(new Set())
  expect(contributedActions()).toEqual([])
  setEnabledPluginNames(new Set([owner]))
  removePluginUiContributions(owner)
  expect(contributedActions()).toEqual([])
})

test('ownership cannot be spoofed and a duplicate cannot replace the destination', () => {
  const host = pluginUiHostFor(owner)
  const first = {
    id: `${owner}:save`,
    label: 'First',
    Icon: () => null,
    when: () => true,
    run: async () => {},
  }
  setEnabledPluginNames(new Set([owner]))
  expect(() => host.actions!.register({ ...first, id: 'other:save' })).toThrow()
  host.actions!.register(first)
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    host.actions!.register({ ...first, label: 'Other' })
    expect(contributedActions()[0]?.label).toBe('First')
  } finally {
    warn.mockRestore()
  }
})
