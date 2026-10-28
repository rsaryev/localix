import { describe, expect, test } from 'bun:test'

import type { ToolLedger } from '../agent-core/tool-ledger'
import type { RemedyContext } from './contracts'
import { renderInspection } from './inspect'

const ledger: ToolLedger = new Map([
  [
    'Loops',
    {
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial: null },
      remedy: { remedyId: 'tool.enable', target: 'Loops' },
    },
  ],
  ['Configure', { state: 'deferred', source: 'Localix' }],
])

const inspect = (target: Parameters<typeof renderInspection>[1]) =>
  renderInspection({} as RemedyContext, target, ledger)

describe('inspecting a tool by the name the model calls it', () => {
  test('a withheld tool answers with its remedy under that name', async () => {
    const text = await inspect({ kind: 'tool', name: 'Loops' })
    expect(text).toStartWith('`Loops` is unavailable')
    expect(text).toContain('name:"Loops"')
  })

  test('a tool behind ToolSearch says so', async () => {
    expect(await inspect({ kind: 'tool', name: 'Configure' })).toStartWith(
      '`Configure` is available behind `ToolSearch`',
    )
  })
})
