import { describe, expect, test } from 'bun:test'

import { parseCommandArgs, type SlashArgSpec } from './SlashArgSpec'

// Mirrors the /plugin command's branching args: a marketplace-only second choice.
const SPECS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    options: [
      { value: 'install', label: 'install' },
      { value: 'marketplace', label: 'marketplace' },
    ],
  },
  {
    name: 'msub',
    type: 'choice',
    when: { arg: 'action', equals: 'marketplace' },
    options: [
      { value: 'add', label: 'add' },
      { value: 'list', label: 'list' },
    ],
  },
  { name: 'args', type: 'text' },
]

describe('parseCommandArgs with a `when`-gated arg', () => {
  test('install skips the marketplace-only sub-action and lands on the text arg', () => {
    const r = parseCommandArgs('install ', SPECS)
    expect(r.chips.map((c) => c.option.value)).toEqual(['install'])
    expect(r.activeSpec?.name).toBe('args') // msub skipped
  })

  test('marketplace activates the sub-action choice', () => {
    const r = parseCommandArgs('marketplace ', SPECS)
    expect(r.chips.map((c) => c.option.value)).toEqual(['marketplace'])
    expect(r.activeSpec?.name).toBe('msub')
  })

  test('marketplace add commits both choices, then the text arg is active', () => {
    const r = parseCommandArgs('marketplace add ', SPECS)
    expect(r.chips.map((c) => c.option.value)).toEqual(['marketplace', 'add'])
    expect(r.activeSpec?.name).toBe('args')
  })
})
