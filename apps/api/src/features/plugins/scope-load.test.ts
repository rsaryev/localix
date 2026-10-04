import { describe, expect, test } from 'bun:test'

import { loadScopesWithinBudget } from './scope-load'

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

// Scopes loaded one after another, and a project blocked on a macOS folder prompt held every
// other project's plugins unwired for as long as the prompt stayed open.
describe('loading plugin scopes within a budget', () => {
  test('projects load concurrently, after the first scope, in their input order', async () => {
    const order: string[] = []
    const started = performance.now()
    const { results, late } = await loadScopesWithinBudget({
      first: {
        key: '',
        load: async () => {
          order.push('global:start')
          await after(10, null)
          order.push('global:end')
          return 'global'
        },
      },
      rest: ['a', 'b', 'c'].map((key) => ({
        key,
        load: async () => {
          order.push(`${key}:start`)
          return after(30, key)
        },
      })),
      budgetMs: 1000,
      onLate: () => {},
    })
    expect(results).toEqual(['global', 'a', 'b', 'c'])
    expect(late).toEqual([])
    // The shared sync happens in the first scope, so no project starts before it ends.
    expect(order.slice(0, 2)).toEqual(['global:start', 'global:end'])
    // Three 30 ms scopes concurrently, not 90 ms in a row.
    expect(performance.now() - started).toBeLessThan(80)
  })

  test('a project past the budget is left out, and reported when it finally answers', async () => {
    const lateCalls: string[] = []
    let release: () => void = () => {}
    const blocked = new Promise<string>((resolve) => (release = () => resolve('blocked')))
    const { results, late } = await loadScopesWithinBudget({
      first: { key: '', load: async () => 'global' },
      rest: [
        { key: 'fast', load: () => after(5, 'fast') },
        { key: 'prompt', load: () => blocked },
      ],
      budgetMs: 40,
      onLate: (key) => lateCalls.push(key),
    })
    expect(results).toEqual(['global', 'fast'])
    expect(late).toEqual(['prompt'])
    expect(lateCalls).toEqual([])
    release()
    await after(0, null)
    expect(lateCalls).toEqual(['prompt'])
  })

  test('a late scope that fails still asks for the reconcile that will report it', async () => {
    const lateCalls: string[] = []
    let fail: () => void = () => {}
    const failing = new Promise<string>((_, reject) => (fail = () => reject(new Error('EPERM'))))
    await loadScopesWithinBudget({
      first: { key: '', load: async () => 'global' },
      rest: [{ key: 'denied', load: () => failing }],
      budgetMs: 10,
      onLate: (key) => lateCalls.push(key),
    })
    fail()
    await after(0, null)
    expect(lateCalls).toEqual(['denied'])
  })

  test('a scope that fails within the budget fails the pass, as before', async () => {
    await expect(
      loadScopesWithinBudget({
        first: { key: '', load: async () => 'global' },
        rest: [
          {
            key: 'broken',
            load: async () => {
              throw new Error('bad manifest')
            },
          },
        ],
        budgetMs: 1000,
        onLate: () => {},
      }),
    ).rejects.toThrow('bad manifest')
  })
})
