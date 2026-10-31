import { describe, expect, test } from 'bun:test'

import type { ContextContribution } from '@localixai/mini-app-sdk/backend'
import { packContextContributions } from '../context-fabric/manager'
import { packCompletionContext } from './completion-context'

const budget = { budgetChars: 2_000, maxWindows: 4, perWindowChars: 600 }

function item(over: Partial<ContextContribution> & { id: string; content: string }) {
  return {
    providerId: 'p',
    providerVersion: '1',
    scope: 'session' as const,
    kind: 'resource',
    priority: 1000,
    sensitivity: 'project' as const,
    ...over,
  }
}

/** A schema far over the prompt budget whose one relevant table sits in the middle. */
function largeSchema(): string {
  const filler = Array.from({ length: 300 }, (_, i) => `CREATE TABLE filler_${i} (id int);`)
  filler.splice(150, 0, 'CREATE TABLE invoices (id int, customer_id int, total numeric);')
  return filler.join('\n')
}

describe('packCompletionContext', () => {
  test('excerpts a contribution larger than the prompt budget instead of dropping it', () => {
    const schema = item({
      id: 'schema',
      uri: 'localix://resource/example/schema',
      content: largeSchema(),
    })
    expect(schema.content.length).toBeGreaterThan(budget.budgetChars * 4)
    // The old order ran the byte-budgeted packer first, which removes it outright.
    expect(
      packContextContributions([schema], { maxBytes: budget.budgetChars, maxItems: 8 })
        .contributions,
    ).toHaveLength(0)

    const [window] = packCompletionContext([schema], {
      querySymbols: new Set(['invoices', 'customer_id']),
      budget,
    })
    expect(window?.content).toContain('CREATE TABLE invoices')
    expect(window!.content.length).toBeLessThanOrEqual(budget.perWindowChars)
  })

  test('drops reasons, the active document and secrets; keeps readable labels', () => {
    const windows = packCompletionContext(
      [
        item({ id: 'why', kind: 'unavailable', content: '@file:x: could not be read' }),
        item({ id: 'self', uri: 'src/open.ts', content: 'export const open = 1' }),
        item({ id: 'key', content: 'password = "abcdefghijklmnopqrstuvwxyz"' }),
        item({ id: 'host:1', kind: 'file', source: { path: '/w/src/util.ts' }, content: 'util' }),
      ],
      { querySymbols: new Set(), budget, activeUri: 'src/open.ts' },
    )
    expect(windows.map((window) => window.filepath)).toEqual(['/w/src/util.ts'])
  })

  test('a linked reference outranks an ambient one with the same relevance', () => {
    const windows = packCompletionContext(
      [
        item({ id: 'ambient', uri: 'tab://a', content: 'orders table', priority: 700 }),
        item({ id: 'linked', uri: 'tab://b', content: 'orders table', priority: 1000 }),
      ],
      { querySymbols: new Set(['orders']), budget },
    )
    expect(windows.map((window) => window.filepath)).toEqual(['tab://b', 'tab://a'])
  })

  test('ranks a draft in any script by its words, not by position', () => {
    const windows = packCompletionContext(
      [
        item({ id: 'a', uri: 'doc://other', content: 'κάτι εντελώς άλλο' }),
        item({ id: 'b', uri: 'doc://match', content: 'πίνακας τιμολογίων και πληρωμών' }),
      ],
      { querySymbols: new Set(['τιμολογίων']), budget: { ...budget, maxWindows: 1 } },
    )
    expect(windows.map((window) => window.filepath)).toEqual(['doc://match'])
  })
})
