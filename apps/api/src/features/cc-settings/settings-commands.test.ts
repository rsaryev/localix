import { expect, test } from 'bun:test'

import type { SettingsLayer } from './settings-files'
import { settingsCommandLine } from './settings-commands'

const layer = (
  source: SettingsLayer['source'],
  settings: Record<string, unknown>,
): SettingsLayer => ({
  source,
  file: `${source}.json`,
  anchorDir: '/',
  settings,
})
const line = (command: string, extra: object = {}) => ({ type: 'command', command, ...extra })

test('the highest file that sets it applies, with its padding and refresh', () => {
  expect(
    settingsCommandLine(
      [
        layer('user', { statusLine: line('mine.sh', { padding: 2 }) }),
        layer('project', { statusLine: line('team.sh', { refreshInterval: 5 }) }),
      ],
      'statusLine',
    ),
  ).toEqual({ command: 'team.sh', padding: 0, refreshInterval: 5 })
})

test('disableAllHooks outside managed settings leaves the managed one; inside, none', () => {
  const layers = [
    layer('user', { statusLine: line('mine.sh'), disableAllHooks: true }),
    layer('policy', { statusLine: line('org.sh') }),
  ]
  expect(settingsCommandLine(layers, 'statusLine')?.command).toBe('org.sh')
  expect(
    settingsCommandLine(
      [layer('user', { statusLine: line('mine.sh'), disableAllHooks: true })],
      'statusLine',
    ),
  ).toBeUndefined()
  expect(
    settingsCommandLine(
      [layer('user', { statusLine: line('mine.sh') }), layer('policy', { disableAllHooks: true })],
      'statusLine',
    ),
  ).toBeUndefined()
  expect(
    settingsCommandLine(
      [
        layer('user', { subagentStatusLine: line('rows.sh') }),
        layer('policy', { allowManagedHooksOnly: true }),
      ],
      'subagentStatusLine',
    ),
  ).toBeUndefined()
})
