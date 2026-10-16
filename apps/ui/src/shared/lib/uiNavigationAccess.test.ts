import { afterEach, describe, expect, test } from 'bun:test'
import type { UiNavigationAction } from '@localixai/plugin-sdk/ui'
import { runUiCommand, setUiCommands, type UiCommandParams } from '@/shared/contrib/uiCommands'
import { registerUiLocation, unregisterUiLocation } from '@/shared/contrib/uiLocations'
import {
  canNavigateUi,
  invokeUi,
  navigateUiAction,
  resolveUiNavigation,
  type UiNavigationHost,
} from './uiNavigation'

const MUTATION_ID = 'test.mutation.rename'
const MUTATION_URI = 'localix://ui/action/tests/rename'
const READ_WRAPPER_ID = 'test.read-wrapper'
const READ_WRAPPER_URI = 'localix://ui/work-item/tests/read-wrapper'

afterEach(() => {
  unregisterUiLocation(MUTATION_ID)
  unregisterUiLocation(READ_WRAPPER_ID)
  setUiCommands([])
})

function commandHost(): UiNavigationHost {
  return {
    open(target, access) {
      if (target.kind === 'command') {
        runUiCommand(target.commandId, access?.allowWrite === true, target.params)
      }
    },
  }
}

describe('URI intent access boundary', () => {
  test('agent ui.navigate cannot invoke a write location, even with forged access metadata', () => {
    let received: UiCommandParams | undefined
    setUiCommands([
      {
        id: 'test.rename',
        label: 'Rename fixture',
        effect: 'write',
        run: (params) => {
          received = params
        },
      },
    ])
    expect(
      registerUiLocation({
        id: MUTATION_ID,
        uri: MUTATION_URI,
        title: 'Rename fixture',
        effect: 'write',
        surface: 'action',
        params: {
          id: { type: 'string', maxLength: 32 },
          name: { type: 'string', maxLength: 80 },
        },
        exposure: { search: true },
        resolve: (args) => ({
          kind: 'command',
          commandId: 'test.rename',
          params: args,
        }),
      }),
    ).toBe(true)
    const uri = `${MUTATION_URI}?id=item-7&name=Renamed`
    const forged = {
      type: 'ui.navigate',
      uri,
      label: 'Rename',
      allowWrite: true,
    } as unknown as UiNavigationAction

    expect(canNavigateUi(uri)).toBe(false)
    expect(resolveUiNavigation(uri)).toBeNull()
    expect(navigateUiAction(forged, commandHost())).toBe(false)
    expect(received).toBeUndefined()
  })

  test('trusted invocation forwards strictly parsed mutation params to the write command', () => {
    let received: UiCommandParams | undefined
    setUiCommands([
      {
        id: 'test.rename',
        label: 'Rename fixture',
        effect: 'write',
        run: (params) => {
          received = params
        },
      },
    ])
    expect(
      registerUiLocation({
        id: MUTATION_ID,
        uri: MUTATION_URI,
        title: 'Rename fixture',
        effect: 'write',
        surface: 'action',
        params: {
          id: { type: 'string', maxLength: 32 },
          name: { type: 'string', maxLength: 80 },
        },
        exposure: { palette: true },
        resolve: (args) => ({
          kind: 'command',
          commandId: 'test.rename',
          params: args,
        }),
      }),
    ).toBe(true)

    expect(
      invokeUi(`${MUTATION_URI}?id=item-7&name=Renamed`, commandHost(), {
        allowWrite: true,
      }),
    ).toBe(true)
    expect(received).toEqual({ id: 'item-7', name: 'Renamed' })
    expect(
      invokeUi(`${MUTATION_URI}?id=item-7&name=Renamed&unexpected=true`, commandHost(), {
        allowWrite: true,
      }),
    ).toBe(false)
    expect(received).toEqual({ id: 'item-7', name: 'Renamed' })
  })

  test('a read descriptor cannot tunnel into a write-classified command', () => {
    let calls = 0
    setUiCommands([
      {
        id: 'test.write',
        label: 'Write fixture',
        effect: 'write',
        run: () => {
          calls += 1
        },
      },
    ])
    expect(
      registerUiLocation({
        id: READ_WRAPPER_ID,
        uri: READ_WRAPPER_URI,
        title: 'Misclassified wrapper',
        effect: 'read',
        surface: 'work-item',
        exposure: {},
        resolve: () => ({ kind: 'command', commandId: 'test.write' }),
      }),
    ).toBe(true)

    expect(resolveUiNavigation(READ_WRAPPER_URI)).toBeNull()
    expect(
      navigateUiAction(
        { type: 'ui.navigate', uri: READ_WRAPPER_URI, label: 'Write' },
        commandHost(),
      ),
    ).toBe(false)
    expect(calls).toBe(0)
  })

  test('agent actions can invoke a registered canonical read command', () => {
    let calls = 0
    setUiCommands([
      {
        id: 'test.read',
        label: 'Read command',
        effect: 'read',
        run: () => {
          calls += 1
        },
      },
    ])

    expect(
      navigateUiAction(
        {
          type: 'ui.navigate',
          uri: 'localix://ui/command/test.read',
          label: 'Read command',
        },
        commandHost(),
      ),
    ).toBe(true)
    expect(calls).toBe(1)
  })

  test('a read command URI cannot invoke a write command even with trusted access', () => {
    let calls = 0
    setUiCommands([
      {
        id: 'test.write',
        label: 'Write command',
        effect: 'write',
        run: () => {
          calls += 1
        },
      },
    ])
    const uri = 'localix://ui/command/test.write'

    expect(resolveUiNavigation(uri)).toBeNull()
    expect(resolveUiNavigation(uri, { allowWrite: true })).toBeNull()
    expect(invokeUi(uri, commandHost(), { allowWrite: true })).toBe(false)
    expect(calls).toBe(0)
  })

  test('an action command URI requires trusted write access and a matching write command', () => {
    let writes = 0
    setUiCommands([
      {
        id: 'test.write',
        label: 'Write command',
        effect: 'write',
        run: () => {
          writes += 1
        },
      },
      {
        id: 'test.read',
        label: 'Read command',
        effect: 'read',
        run: () => {
          writes += 100
        },
      },
    ])
    const writeUri = 'localix://ui/action/command/test.write'
    const mismatchedUri = 'localix://ui/action/command/test.read'

    expect(resolveUiNavigation(writeUri)).toBeNull()
    expect(invokeUi(writeUri, commandHost())).toBe(false)
    expect(resolveUiNavigation(mismatchedUri, { allowWrite: true })).toBeNull()
    expect(invokeUi(mismatchedUri, commandHost(), { allowWrite: true })).toBe(false)
    expect(invokeUi(writeUri, commandHost(), { allowWrite: true })).toBe(true)
    expect(writes).toBe(1)
  })
})
