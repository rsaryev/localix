import { describe, expect, it } from 'bun:test'
import { createStaticContextProvider } from './static-context-provider'
import type { AutomaticContextProvider, AutomaticContextRequest } from './context-fabric'

const request = (destination: AutomaticContextRequest['destination']): AutomaticContextRequest => ({
  destination,
  userId: 'user',
  maxBytes: 10_000,
})

describe('createStaticContextProvider', () => {
  it('emits deterministic, destination-scoped guidance and honors cancellation', async () => {
    const contribution = createStaticContextProvider({ id: 'test.instructions', content: 'Guide' })
    const provider = contribution.provider as AutomaticContextProvider
    const signal = new AbortController().signal
    const first = await provider.provide(request('chat'), signal)
    const second = await provider.provide(request('chat'), signal)
    expect(first).toEqual(second)
    expect(first[0]).toMatchObject({ content: 'Guide', scope: 'global', sensitivity: 'public' })
    expect(await provider.provide(request('title-generation'), signal)).toEqual([])
    const aborted = new AbortController()
    aborted.abort()
    expect(await provider.provide(request('chat'), aborted.signal)).toEqual([])
  })
})
