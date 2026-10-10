import { expect, test } from 'bun:test'
import { collectResourcePages } from './mcp-resource-pages'

test('an empty opaque cursor continues the scan even when the first page has no items', async () => {
  const calls: (string | undefined)[] = []
  const item = { uri: 'resource://fixture' }
  const result = await collectResourcePages({
    serverName: 'fixture',
    operation: 'resources/list',
    async listPage(cursor) {
      calls.push(cursor)
      if (calls.length === 1) return { items: [], nextCursor: '' }
      if (calls.length === 2) return { items: [item] }
      throw new Error('Read after the final page')
    },
  })
  expect(calls).toEqual([undefined, ''])
  expect(result).toEqual([item])
  expect(result[0]).toBe(item)
})

test('a page failure propagates the original error and stops pagination', async () => {
  const calls: (string | undefined)[] = []
  const error = new Error('resource page unavailable')
  let caught: unknown
  try {
    await collectResourcePages({
      serverName: 'fixture',
      operation: 'resources/templates/list',
      async listPage(cursor) {
        calls.push(cursor)
        if (calls.length === 1) return { items: ['first'], nextCursor: 'next' }
        throw error
      },
    })
  } catch (failure) {
    caught = failure
  }
  expect(caught).toBe(error)
  expect(calls).toEqual([undefined, 'next'])
})
