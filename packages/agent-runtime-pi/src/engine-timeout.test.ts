import { expect, spyOn, test } from 'bun:test'

import { createPiEngine } from './engine'
import { requestTuning } from './stream-options'

test('shared transport tuning preserves zero and omits unset settings', () => {
  expect(requestTuning({})).toEqual({})
  expect(requestTuning({ maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 40 })).toEqual({
    maxRetries: 0,
    maxRetryDelayMs: 0,
    timeoutMs: 40,
  })
})

test('the engine timeout reaches buffered completions as well as the agent loop', async () => {
  let requests = 0
  // Intercept transport completely: a stalled response with a signal, no provider spend.
  const stalledFetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests++
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new DOMException('Aborted', 'AbortError'))
        if (init?.signal?.aborted) fail()
        else init?.signal?.addEventListener('abort', fail, { once: true })
      })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(stalledFetch)
  const guard = new AbortController()
  const timer = setTimeout(() => guard.abort(new Error('test deadline')), 1500)
  const engine = createPiEngine({ timeoutMs: 25, maxRetries: 0 })
  const model = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }
  const credential = { type: 'api-key' as const, key: 'unused' }
  try {
    const completion = engine.languageModels.create(model, credential)
    await expect(
      completion.complete({
        systemPrompt: '',
        messages: [{ role: 'user', content: 'go', timestamp: 0 }],
        signal: guard.signal,
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(guard.signal.aborted).toBe(false)

    const run = engine.runtime.run({
      sessionId: 'timeout-test',
      systemPrompt: '',
      messages: [{ role: 'user', content: 'go', timestamp: 0 }],
      model,
      credential,
      tools: [],
      signal: guard.signal,
    })
    // Iteration rejects on a provider failure; terminal status remains independently usable.
    try {
      for await (const _event of run) {
        /* drain */
      }
    } catch {
      /* inspect result */
    }
    expect((await run.result).terminal).toBe('failed')
    expect(guard.signal.aborted).toBe(false)
    expect(requests).toBe(2)
  } finally {
    clearTimeout(timer)
    guard.abort()
    fetchSpy.mockRestore()
  }
})
