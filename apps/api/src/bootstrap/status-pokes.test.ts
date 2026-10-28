import { describe, expect, test } from 'bun:test'

import { startModelStatusPokes } from './status-pokes'

/** An owner's in-process signal: `fire` is the owner announcing that its status moved. */
function signal() {
  const listeners = new Set<() => void>()
  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  function fire() {
    for (const listener of listeners) listener()
  }
  return { subscribe, fire }
}

describe('status pokes', () => {
  test('a moved recommendation answer pokes its topic, and the meaning model moving works them out again', () => {
    const semantic = signal()
    const recommendations = signal()
    const published: string[][] = []
    let refreshed = 0
    const controller = new AbortController()

    startModelStatusPokes({
      localModels: signal(),
      semanticService: semantic,
      store: {
        subscribe: signal().subscribe,
        subscribeSources: signal().subscribe,
        subscribeRecommendations: recommendations.subscribe,
        refreshRecommendations: () => void refreshed++,
      },
      chatService: {
        streamRegistry: {
          publish: (_userId, _sessionId, event) =>
            void published.push((event as { resources: string[] }).resources),
        },
      },
      env: { LOCALIX_DEFAULT_USER_ID: 'u1' },
      signal: controller.signal,
    })

    recommendations.fire()
    semantic.fire()
    controller.abort()

    expect(published).toEqual([['store-recommendations'], ['semantic']])
    expect(refreshed).toBe(1)
  })
})
