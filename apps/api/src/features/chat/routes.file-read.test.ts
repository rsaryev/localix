import { describe, expect, test } from 'bun:test'

import { createChatRoutes, type ChatRoutesService } from './routes'
import type { FileContentResponse } from './contracts'

describe('file-read route cancellation', () => {
  test('passes the HTTP request signal into the chat service', async () => {
    let serviceSignal: AbortSignal | undefined
    const result: FileContentResponse = {
      path: '/workspace/a.ts',
      content: 'a',
      bytes: 1,
      truncated: false,
      hash: 'hash-a',
    }
    const service = {
      readFile: async (
        _userId: string,
        _sessionId: string,
        _path: string,
        opts?: { signal?: AbortSignal },
      ) => {
        serviceSignal = opts?.signal
        return result
      },
    } as unknown as ChatRoutesService
    const caller = new AbortController()

    const response = await createChatRoutes(service).request(
      new Request('http://local/sessions/session-a/file?path=a.ts', {
        signal: caller.signal,
      }),
    )

    expect(response.status).toBe(200)
    expect(serviceSignal).toBeInstanceOf(AbortSignal)
    expect(serviceSignal?.aborted).toBe(false)
    caller.abort()
    expect(serviceSignal?.aborted).toBe(true)
  })
})
