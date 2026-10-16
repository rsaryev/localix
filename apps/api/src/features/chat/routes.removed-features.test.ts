import { expect, test } from 'bun:test'
import { createChatRoutes, type ChatRoutesService } from './routes'

test('the removed prompt-improvement endpoint returns 404 without calling a service', async () => {
  let called = false
  const service = {
    improvePrompt: () => {
      called = true
      return { prompt: 'rewritten' }
    },
  } as unknown as ChatRoutesService

  const response = await createChatRoutes(service).request('/sessions/s1/improve-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'original' }),
  })

  expect(response.status).toBe(404)
  expect(called).toBe(false)
})
