import { describe, expect, test } from 'bun:test'

import { createPreviewServerCache } from './preview-server-cache'

type Server = ReturnType<Parameters<ReturnType<typeof createPreviewServerCache>['ensure']>[1]>

function fakeServer(port: number, stopped: number[]): Server {
  return {
    port,
    stop(force?: boolean) {
      expect(force).toBe(true)
      stopped.push(port)
      return Promise.resolve()
    },
  } as Server
}

describe('preview server cache lifecycle', () => {
  test('evicts the least-recently-used server and refreshes hits', () => {
    const stopped: number[] = []
    const cache = createPreviewServerCache('test', 2)
    expect(cache.ensure('a', () => fakeServer(1, stopped))).toBe(1)
    expect(cache.ensure('b', () => fakeServer(2, stopped))).toBe(2)
    expect(cache.ensure('a', () => fakeServer(99, stopped))).toBe(1)
    expect(cache.ensure('c', () => fakeServer(3, stopped))).toBe(3)

    expect(stopped).toEqual([2])
    expect(cache.size()).toBe(2)
    cache.dispose()
    expect(stopped).toEqual([2, 1, 3])
    expect(cache.size()).toBe(0)
  })

  test('does not cache an unbound server', () => {
    const stopped: number[] = []
    const cache = createPreviewServerCache('test', 1)
    expect(() =>
      cache.ensure(
        'bad',
        () =>
          ({
            port: undefined,
            stop(force?: boolean) {
              expect(force).toBe(true)
              stopped.push(1)
            },
          }) as Server,
      ),
    ).toThrow('preview test server failed to bind a port')
    expect(cache.size()).toBe(0)
    expect(stopped).toEqual([1])
  })

  test('rejects invalid capacity at construction', () => {
    expect(() => createPreviewServerCache('test', 0)).toThrow(
      'Invalid preview test server cache size: 0',
    )
  })
})
