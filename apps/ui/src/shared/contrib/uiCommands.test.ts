import { afterEach, describe, expect, test } from 'bun:test'
import type { UiCommandEntry } from './uiCommands'
import {
  getUiCommands,
  hasUiCommand,
  runUiCommand,
  setUiCommands,
  uiCommandRevision,
} from './uiCommands'

afterEach(() => setUiCommands([]))

function command(
  id: string,
  effect: 'read' | 'write',
  run: UiCommandEntry['run'] = () => {},
): UiCommandEntry {
  return {
    id,
    label: id,
    effect,
    run,
  }
}

describe('UI command access classification', () => {
  test('fails registration deterministically for missing metadata and duplicate ids', () => {
    const revision = uiCommandRevision()
    setUiCommands([command('valid.read', 'read')])
    expect(uiCommandRevision()).toBe(revision + 1)

    expect(() =>
      setUiCommands([command('duplicate', 'read'), command('duplicate', 'write')]),
    ).toThrow('[ui-commands] duplicate id "duplicate"')
    expect(() =>
      setUiCommands([
        {
          id: 'missing.effect',
          label: 'Missing effect',
          run: () => {},
        } as UiCommandEntry,
      ]),
    ).toThrow('[ui-commands] invalid required metadata for "missing.effect"')

    expect(getUiCommands().map(({ id }) => id)).toEqual(['valid.read'])
    expect(uiCommandRevision()).toBe(revision + 1)
  })

  test('keeps writes unavailable unless the caller explicitly opts into trusted access', () => {
    let calls = 0
    setUiCommands([
      command('read.open', 'read', () => {
        calls += 1
      }),
      command('write.reset', 'write', () => {
        calls += 10
      }),
    ])

    expect(hasUiCommand('read.open')).toBe(true)
    expect(hasUiCommand('write.reset')).toBe(false)
    expect(runUiCommand('read.open')).toBe(true)
    expect(runUiCommand('write.reset')).toBe(false)
    expect(calls).toBe(1)

    expect(hasUiCommand('write.reset', true)).toBe(true)
    expect(runUiCommand('write.reset', true)).toBe(true)
    expect(calls).toBe(11)
  })

  test('passes only location-normalized params to a trusted command invocation', () => {
    let received: unknown
    setUiCommands([
      command('write.rename', 'write', (params) => {
        received = params
      }),
    ])

    const params = { id: 'item-7', name: 'Renamed' }
    expect(runUiCommand('write.rename', false, params)).toBe(false)
    expect(received).toBeUndefined()
    expect(runUiCommand('write.rename', true, params)).toBe(true)
    expect(received).toEqual(params)
  })

  test('copies registrations and snapshots so metadata cannot be reclassified by mutation', () => {
    const input = command('write.protected', 'write')
    setUiCommands([input])

    input.effect = 'read'
    getUiCommands()[0]!.effect = 'read'

    expect(hasUiCommand('write.protected')).toBe(false)
    expect(runUiCommand('write.protected')).toBe(false)
  })
})
