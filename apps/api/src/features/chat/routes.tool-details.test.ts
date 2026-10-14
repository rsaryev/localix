import { describe, expect, test } from 'bun:test'

import { createChatRoutes, type ChatRoutesService } from './routes'

describe('tool-detail routes', () => {
  test('session-open opt-in reaches the read-model projection flag', async () => {
    let options: unknown
    const service = {
      getSession: async (_userId: string, _sessionId: string, opts: unknown) => {
        options = opts
        return { messages: [] }
      },
    } as unknown as ChatRoutesService

    const response = await createChatRoutes(service).request(
      new Request('http://local/sessions/session-a?toolDetails=deferred'),
    )

    expect(response.status).toBe(200)
    expect(options).toEqual({ messageLimit: undefined, deferToolDetails: true })
  })

  test('resolves one exact message through the owner-scoped service seam', async () => {
    const calls: unknown[][] = []
    const service = {
      getMessageToolDetails: async (...args: unknown[]) => {
        calls.push(args)
        return { items: [] }
      },
    } as unknown as ChatRoutesService

    const response = await createChatRoutes(service).request(
      new Request('http://local/sessions/session-a/messages/message-a/tool-details'),
    )

    expect(response.status).toBe(200)
    // Auth middleware owns the real user id; a bare route harness leaves it undefined.
    expect(calls).toEqual([[undefined, 'session-a', 'message-a']])
    expect(await response.json()).toEqual({ items: [] })
  })

  test('ordinary and message-limited reads retain full-detail semantics', async () => {
    const options: unknown[] = []
    const service = {
      getSession: async (_userId: string, _sessionId: string, opts: unknown) => {
        options.push(opts)
        return { messages: [] }
      },
    } as unknown as ChatRoutesService
    const routes = createChatRoutes(service)

    await routes.request(new Request('http://local/sessions/session-a'))
    await routes.request(new Request('http://local/sessions/session-a?messageLimit=40'))

    expect(options).toEqual([
      { messageLimit: undefined, deferToolDetails: false },
      { messageLimit: 40, deferToolDetails: false },
    ])
  })
})
