import { expect, test } from 'bun:test'
import { withDiscoveryRetry } from './mcp-tool-discovery'

test('discovery retries a transient failure and returns the successful result', async () => {
  let attempts = 0
  const value = { tools: [] }
  const result = await withDiscoveryRetry(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('ECONNRESET during discovery')
    return value
  })
  expect(attempts).toBe(2)
  expect(result).toBe(value)
})

test('discovery propagates the original authorization error without retrying', async () => {
  let attempts = 0
  const error = new Error('401 Unauthorized')
  let caught: unknown
  try {
    await withDiscoveryRetry(async () => {
      attempts += 1
      throw error
    })
  } catch (failure) {
    caught = failure
  }
  expect(caught).toBe(error)
  expect(attempts).toBe(1)
})
