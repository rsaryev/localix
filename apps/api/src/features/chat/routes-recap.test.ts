import { describe, expect, test } from 'bun:test'

import { createChatRoutes, type ChatRoutesService } from './routes'

function harness(outcome: unknown) {
  const calls: unknown[][] = []
  const service = {
    requestSessionRecap: async (...args: unknown[]) => {
      calls.push(args)
      return outcome
    },
  } as unknown as ChatRoutesService
  const post = (id: string) =>
    createChatRoutes(service).request(
      new Request(`http://local/sessions/${id}/recap`, { method: 'POST' }),
    )
  return { calls, post }
}

describe('POST /sessions/:id/recap', () => {
  test('asks for the automatic recap of that session and reports what happened', async () => {
    const { calls, post } = harness({ status: 'skipped', reason: 'too-soon' })
    const response = await post('session-a')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'skipped', reason: 'too-soon' })
    // Auth middleware owns the real user id; a bare route harness leaves it undefined.
    expect(calls).toEqual([[undefined, 'session-a']])
  })
})
