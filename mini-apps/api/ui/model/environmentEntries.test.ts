import { describe, expect, mock, test } from 'bun:test'
import type { MenuActionEntry, MenuEntry } from '@localixai/mini-app-sdk/ui'

import type { EnvironmentInfo } from '../../backend/contracts'
import { environmentEntries } from './environmentEntries'

const env = (name: string, active: boolean, vars: number): EnvironmentInfo => ({
  name,
  active,
  variables: Array.from({ length: vars }, (_, i) => ({ name: `k${i}`, value: '' })),
})

const actions = (entries: MenuEntry[]) =>
  entries.filter((entry): entry is MenuActionEntry => 'onSelect' in entry)

describe('environmentEntries', () => {
  test('a radio list: one selected row, the count as a hint rather than in the name', () => {
    const rows = actions(
      environmentEntries({
        environments: [env('staging', true, 3), env('prod', false, 1)],
        onUse: () => {},
        header: 'Active environment',
      }),
    )
    expect(rows.map((row) => [row.label, row.selected, row.hint])).toEqual([
      ['No environment', false, undefined],
      ['staging', true, '3 vars'],
      ['prod', false, '1 var'],
    ])
    // `checked` would be a checkbox, whose mark takes the icon's slot.
    expect(rows.every((row) => row.checked === undefined)).toBe(true)
  })

  test('no active environment selects the "No environment" row, which deactivates', () => {
    const onUse = mock((_name: string) => {})
    const rows = actions(
      environmentEntries({ environments: [env('dev', false, 0)], onUse, header: 'Send against' }),
    )
    expect(rows[0]!.selected).toBe(true)
    rows[0]!.onSelect()
    rows[1]!.onSelect()
    expect(onUse.mock.calls).toEqual([[''], ['dev']])
  })
})
