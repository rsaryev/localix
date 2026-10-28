import { describe, expect, test } from 'bun:test'
import { classifyToolCall } from '@localixai/agent/agents'
import type { ToolLedger } from '../tool-ledger'
import { withheldToolStubs } from './withheld-stub'

/**
 * A stub runs nothing, so its call must not be gated as a write: classified `external` (the
 * reading of an undeclared tool), a plan session would refuse it and an ask rule would raise a
 * card — either way the model hears the gate instead of the reason the tool is unavailable.
 */
describe('withheld tool stubs', () => {
  const ledger: ToolLedger = new Map([
    ['Write', { state: 'withheld', reason: { layer: 'policy', kind: 'rule', denial: null } }],
    ['Read', { state: 'live' }],
  ])

  test('only a withheld built-in gets a stub', () => {
    expect(withheldToolStubs(ledger, new Set()).map((t) => t.name)).toEqual(['Write'])
  })

  test.each([
    ['a call shaped like the real tool', { path: 'a.txt', content: 'x' }],
    ['anything else', 'not an object'],
  ])('%s classifies as a read', (_label, input) => {
    const [stub] = withheldToolStubs(ledger, new Set())
    expect(classifyToolCall(stub, input)).toEqual({ effect: 'read' })
  })

  test('the stub answers with the reason, not a result', async () => {
    const [stub] = withheldToolStubs(ledger, new Set())
    const result = await stub!.execute('t', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('unavailable in this run')
  })

  test('names the tool and its remedy as the model calls them, with `Configure` behind `ToolSearch`', async () => {
    const deferred: ToolLedger = new Map([
      [
        'Write',
        {
          state: 'withheld',
          reason: { layer: 'policy', kind: 'rule', denial: null },
          remedy: { remedyId: 'tool.enable', target: 'Write' },
        },
      ],
      ['Configure', { state: 'deferred', source: 'Localix' }],
    ])
    const [stub] = withheldToolStubs(deferred, new Set())
    const result = await stub!.execute('t', {})
    expect(result.content).toContain('`Write` is unavailable in this run')
    expect(result.content).toContain('name:"Write"')
  })
})
