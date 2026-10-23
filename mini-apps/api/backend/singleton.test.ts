import { afterAll, describe, expect, test } from 'bun:test'
import { secretConsumerFor, type ResolveSecret } from './secrets'
import { bindVault, getResolveSecret } from './singleton'

// The holder lives on `globalThis`; a fake resolver left bound would answer for every later file.
afterAll(() => {
  delete (globalThis as { [key: symbol]: unknown })[Symbol.for('localix.mini-app.api.services')]
})

describe('getResolveSecret', () => {
  test('the saved request that reads a secret reaches the host resolver', async () => {
    // The wrapper used to take `(userId, key)` only, so the vault audit attributed every read to
    // the mini app as a whole instead of the request that made it.
    const seen: Parameters<ResolveSecret>[] = []
    bindVault({
      resolveSecret: async (...args) => {
        seen.push(args)
        return 'value'
      },
    })
    const consumer = secretConsumerFor('Get users', 'token')
    expect(await getResolveSecret()('u1', 'API_TOKEN', consumer)).toBe('value')
    expect(seen).toEqual([['u1', 'API_TOKEN', consumer]])
  })
})
