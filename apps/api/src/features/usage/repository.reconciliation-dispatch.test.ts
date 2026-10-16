import { expect, test } from 'bun:test'
import { createUsageRepository } from './repository'

test('reconciliation follows the current page method until the scan completes', async () => {
  const repository = createUsageRepository({} as never)
  const calls: { afterId: string | null; limit: number }[] = []
  const pages = [
    { repaired: 2, lastId: 'message-a' },
    { repaired: 1, lastId: null },
  ]
  repository.reconcileAssistantMessagePage = async (page) => {
    calls.push(page)
    const result = pages.shift()
    if (!result) throw new Error('Reconciliation continued after the final page')
    return result
  }

  expect(await repository.reconcileAssistantMessageEvents()).toBe(3)
  expect(calls).toEqual([
    { afterId: null, limit: 500 },
    { afterId: 'message-a', limit: 500 },
  ])
})
