import { describe, expect, test } from 'bun:test'

import type { RealtimeResource } from '../features/realtime/resources'
import { invalidateStoreOn } from './store'

describe('the Store’s wiring', () => {
  test('a relayed poke for the Store also tells its index to rebuild; others pass through', () => {
    let invalidated = 0
    const sent: [string, RealtimeResource[]][] = []
    const publish = invalidateStoreOn({ invalidate: () => void invalidated++ }, (userId, r) =>
      sent.push([userId, r]),
    )
    publish('u1', ['mini-apps', 'capabilities'])
    expect(invalidated).toBe(0)
    publish('u1', ['mini-app-catalogs', 'store'])
    expect(invalidated).toBe(1)
    expect(sent).toEqual([
      ['u1', ['mini-apps', 'capabilities']],
      ['u1', ['mini-app-catalogs', 'store']],
    ])
  })
})
