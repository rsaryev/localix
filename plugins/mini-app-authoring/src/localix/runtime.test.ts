import { describe, expect, test } from 'bun:test'

import { localixRequest } from './runtime'

/** A Localix that accepted the connection and never answers; it settles only when aborted. */
const wedged = ((_url: URL, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })) as unknown as typeof fetch

describe('localixRequest', () => {
  test('a Localix that never answers fails the request instead of stalling the caller', async () => {
    await expect(
      localixRequest(
        { baseUrl: 'http://127.0.0.1:5051' },
        '/rpc/mini-apps/kit',
        { timeoutMs: 1 },
        wedged,
      ),
    ).rejects.toThrow('did not answer')
  })
})
