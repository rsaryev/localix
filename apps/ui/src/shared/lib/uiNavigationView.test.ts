import { afterEach, describe, expect, test } from 'bun:test'
import type { UiNavigationAction } from '@localixai/plugin-sdk/ui'
import { setUiCommands } from '@/shared/contrib/uiCommands'
import { registerUiLocation, unregisterUiLocation } from '@/shared/contrib/uiLocations'
import { viewUiNavigationAction } from './uiNavigation'

const LOCATION_ID = 'test.view.terminal'
const LOCATION_URI = 'localix://ui/work-item/tests/view-terminal'
const COMMAND_ID = 'test.view.command'
const COMMAND_URI = 'localix://ui/command/tests/view-command'

afterEach(() => {
  unregisterUiLocation(LOCATION_ID)
  unregisterUiLocation(COMMAND_ID)
  setUiCommands([])
})

function action(uri: string, over: Partial<UiNavigationAction> = {}): UiNavigationAction {
  return {
    type: 'ui.navigate',
    uri,
    label: 'Serialized label',
    description: 'Serialized description',
    ...over,
  }
}

describe('viewUiNavigationAction', () => {
  test('runs the owner resolver once per action, not once per answer', () => {
    let resolveCalls = 0
    let presentCalls = 0
    registerUiLocation({
      id: LOCATION_ID,
      uri: LOCATION_URI,
      title: 'Registered title',
      description: 'Registered description',
      keywords: [],
      effect: 'read',
      surface: 'work-item',
      exposure: { search: true, palette: true },
      params: {},
      present: () => {
        presentCalls += 1
        return { label: 'Live label', description: 'Live description' }
      },
      resolve: () => {
        resolveCalls += 1
        return { kind: 'work-item', workKind: 'terminal', id: 't', title: 'T' }
      },
    })

    const view = viewUiNavigationAction(action(LOCATION_URI))

    expect(view).toEqual({
      available: true,
      label: 'Live label',
      description: 'Live description',
    })
    // Availability and copy come from the SAME resolution. Two calls here means the
    // renderer pays the owner's resolver twice for every button it draws.
    expect(resolveCalls).toBe(1)
    expect(presentCalls).toBe(1)
  })

  test('falls back to serialized copy when nothing owns the URI', () => {
    expect(viewUiNavigationAction(action('localix://ui/work-item/tests/absent'))).toEqual({
      available: false,
      label: 'Serialized label',
      description: 'Serialized description',
    })
  })

  test('omits a description the action never carried', () => {
    const view = viewUiNavigationAction(
      action('localix://ui/work-item/tests/absent', { description: undefined }),
    )
    expect(view.available).toBe(false)
    expect(view).not.toHaveProperty('description')
  })

  test('keeps the owner label on a gated command while reporting it unavailable', () => {
    // The command is registered as a location but absent from the command registry, so
    // it must not be clickable — yet its own copy is still the honest thing to show.
    registerUiLocation({
      id: COMMAND_ID,
      uri: COMMAND_URI,
      title: 'Registered command',
      keywords: [],
      effect: 'read',
      surface: 'command',
      exposure: { search: true, palette: true },
      params: {},
      present: () => ({ label: 'Live command label' }),
      resolve: () => ({ kind: 'command', commandId: 'test.view.missing' }),
    })
    setUiCommands([])

    expect(viewUiNavigationAction(action(COMMAND_URI))).toEqual({
      available: false,
      label: 'Live command label',
    })
  })
})
