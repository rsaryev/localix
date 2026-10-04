import { describe, expect, test } from 'bun:test'
import { localixUriNamespace } from '../resource'
import {
  isUiNavigationAction,
  isUiNavigationOutput,
  isUiNavigationRequest,
  isUiNavigationSuggestions,
} from './anchors'

describe('localixUriNamespace', () => {
  test('returns the first breadcrumb for every canonical Localix primitive', () => {
    expect(localixUriNamespace('localix://resource/fixture-db/connection/main')).toBe('fixture-db')
    expect(localixUriNamespace('localix://ui/settings/plugins')).toBe('settings')
    expect(localixUriNamespace('localix://ui/page/chat')).toBe('page')
  })

  test('rejects non-Localix and incomplete identities', () => {
    expect(localixUriNamespace('db://main')).toBeNull()
    expect(localixUriNamespace('localix://resource')).toBeNull()
    expect(localixUriNamespace('localix://ui/settings')).toBeNull()
  })
})

describe('isUiNavigationAction', () => {
  test('accepts the provider-neutral navigation contract', () => {
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://ui/settings/tools/tool-sample-renderer',
        label: 'Open tool settings',
        description: 'Enable the renderer if you want to use it.',
      }),
    ).toBe(true)
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://resource/fixture-course/bun-deep-dive',
        label: 'Open course',
      }),
    ).toBe(true)
  })

  test('rejects incomplete and unrelated tool details', () => {
    expect(isUiNavigationAction({ type: 'ui.navigate', uri: '', label: 'Open' })).toBe(false)
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://ui/command',
        label: 'Incomplete command',
      }),
    ).toBe(false)
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://ui/action/command/plugins.enable',
        label: 'Enable plugin',
      }),
    ).toBe(false)
    expect(isUiNavigationAction({ type: 'ui.navigate', uri: 'localix://ui/settings/tools' })).toBe(
      false,
    )
    expect(
      isUiNavigationAction({
        type: 'table',
        uri: 'localix://ui/settings/tools',
        label: 'Open',
      }),
    ).toBe(false)
  })

  test('bounds persisted presentation text', () => {
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://ui/settings/tools',
        label: '   ',
      }),
    ).toBe(false)
    expect(
      isUiNavigationAction({
        type: 'ui.navigate',
        uri: 'localix://ui/settings/tools',
        label: 'Open tools',
        description: 'x'.repeat(241),
      }),
    ).toBe(false)
  })
})

describe('isUiNavigationRequest', () => {
  test('accepts a fresh one-shot request for a read-only plugin resource', () => {
    const request = {
      type: 'ui.navigate.request',
      uri: 'localix://resource/fixture-course/bun-deep-dive',
      label: 'Open course',
      issuedAt: Date.now(),
    }
    expect(isUiNavigationRequest(request)).toBe(true)
    expect(isUiNavigationOutput(request)).toBe(true)
  })

  test('rejects missing timestamps and write-action destinations', () => {
    expect(
      isUiNavigationRequest({
        type: 'ui.navigate.request',
        uri: 'localix://resource/fixture-course/bun-deep-dive',
        label: 'Open course',
      }),
    ).toBe(false)
    expect(
      isUiNavigationRequest({
        type: 'ui.navigate.request',
        uri: 'localix://ui/action/command/plugins.enable',
        label: 'Enable plugin',
        issuedAt: Date.now(),
      }),
    ).toBe(false)
  })
})

describe('isUiNavigationSuggestions', () => {
  const action = {
    type: 'ui.navigate',
    uri: 'localix://ui/settings/plugins',
    label: 'Plugins',
    description: 'Open installed plugin settings.',
  } as const

  test('accepts a bounded, duplicate-free list of safe navigation actions', () => {
    const suggestions = {
      type: 'ui.navigate.suggestions',
      suggestions: [
        action,
        {
          type: 'ui.navigate',
          uri: 'localix://ui/sidebar/capabilities',
          label: 'Capabilities',
        },
      ],
    }
    expect(isUiNavigationSuggestions(suggestions)).toBe(true)
    expect(isUiNavigationOutput(suggestions)).toBe(true)
    expect(isUiNavigationOutput(action)).toBe(true)
  })

  test('rejects empty, oversized, duplicate, and write-action lists', () => {
    expect(isUiNavigationSuggestions({ type: 'ui.navigate.suggestions', suggestions: [] })).toBe(
      false,
    )
    expect(
      isUiNavigationSuggestions({
        type: 'ui.navigate.suggestions',
        suggestions: Array.from({ length: 11 }, (_, index) => ({
          ...action,
          uri: `localix://ui/settings/plugins-${index}`,
        })),
      }),
    ).toBe(false)
    expect(
      isUiNavigationSuggestions({
        type: 'ui.navigate.suggestions',
        suggestions: [action, action],
      }),
    ).toBe(false)
    expect(
      isUiNavigationSuggestions({
        type: 'ui.navigate.suggestions',
        suggestions: [
          {
            ...action,
            uri: 'localix://ui/action/plugins/enable',
          },
        ],
      }),
    ).toBe(false)
  })
})
