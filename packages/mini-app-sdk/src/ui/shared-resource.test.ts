import { describe, expect, test } from 'bun:test'

import { createSharedResource, GLOBAL_RESOURCE_KEY } from './shared-resource'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The rules a status item's data has to obey, held once here instead of in every plugin.
 *
 * Each is a mistake the hand-written version of this cache made or invited: a second reader paying
 * for the same list again, a re-read fired because the answer was legitimately empty, and a
 * dropped request wiping the control off the chrome. The React glue on top is three lines —
 * `useSyncExternalStore` over {@link SharedResource.subscribe}, plus a mount effect — and the
 * store below is where the behaviour actually lives, so this suite needs no DOM to hold it.
 */
describe('createSharedResource', () => {
  test('a key is fetched once, however many readers ask for it', async () => {
    let calls = 0
    const resource = createSharedResource(async (key) => {
      calls += 1
      return `${key}:${calls}`
    })

    // Three concurrent asks — the `inFlight` guard is what makes them one request.
    resource.refresh(GLOBAL_RESOURCE_KEY)
    resource.refresh(GLOBAL_RESOURCE_KEY)
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()

    expect(calls).toBe(1)
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe('global:1')
  })

  test('an empty answer still counts as loaded', async () => {
    let calls = 0
    const resource = createSharedResource(async () => {
      calls += 1
      return [] as string[]
    })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()

    // The mount effect guards on `has`, not on truthiness. A plugin with no saved connections
    // would otherwise re-ask on every mount, forever, for the answer it already has.
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toEqual([])
    expect(calls).toBe(1)
  })

  test('a failed load keeps the last good value', async () => {
    let attempt = 0
    const resource = createSharedResource(async () => {
      attempt += 1
      if (attempt > 1) throw new Error('network')
      return 'first'
    })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe('first')

    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    // Not blanked. A control that disappears because one request lost is worse than a stale one.
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe('first')
  })

  test('a failure does not wedge the key — the next refresh still tries', async () => {
    let attempt = 0
    const resource = createSharedResource(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('network')
      return 'recovered'
    })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBeUndefined()

    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe('recovered')
  })

  test('keys are independent, and an unread one is undefined', async () => {
    const resource = createSharedResource(async (key) => key.toUpperCase())
    resource.refresh('a')
    resource.refresh('b')
    await settle()

    expect(resource.peek('a')).toBe('A')
    expect(resource.peek('b')).toBe('B')
    expect(resource.peek('c')).toBeUndefined()
  })

  test('an absent key addresses nothing and fetches nothing', async () => {
    let calls = 0
    const resource = createSharedResource(async () => {
      calls += 1
      return 'x'
    })
    resource.refresh('')
    await settle()

    expect(calls).toBe(0)
    expect(resource.peek(null)).toBeUndefined()
    expect(resource.peek(undefined)).toBeUndefined()
  })

  test('every subscriber is woken once per landed value', async () => {
    let round = 0
    const resource = createSharedResource(async () => {
      round += 1
      return round
    })
    let a = 0
    let b = 0
    const stopA = resource.subscribe(() => {
      a += 1
    })
    resource.subscribe(() => {
      b += 1
    })

    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect([a, b]).toEqual([1, 1])

    stopA()
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    // The unsubscribed listener stops hearing; the other keeps its place.
    expect([a, b]).toEqual([1, 2])
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe(2)
  })

  test('reset forgets everything and announces it', async () => {
    let calls = 0
    const resource = createSharedResource(async () => {
      calls += 1
      return calls
    })
    let woken = 0
    resource.subscribe(() => {
      woken += 1
    })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(woken).toBe(1)

    resource.reset()
    // Announced, or a mounted reader would keep painting a value the store no longer has.
    expect(woken).toBe(2)
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBeUndefined()

    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(calls).toBe(2)
  })
})

test('invalidation during the first read queues a fresh snapshot instead of caching the old one', async () => {
  const releases: Array<(value: string) => void> = []
  const resource = createSharedResource(
    () => new Promise<string>((resolve) => releases.push(resolve)),
  )
  resource.refresh('a')
  await settle()
  resource.refresh('a')
  releases[0]!('old')
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(resource.peek('a')).toBeUndefined()
  releases[1]!('new')
  await settle()
  expect(resource.peek('a')).toBe('new')
  resource.dispose()
})

test('reset and dispose prevent pending responses from restoring discarded state', async () => {
  for (const operation of ['reset', 'dispose'] as const) {
    let release!: (value: string) => void
    const resource = createSharedResource(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    resource.refresh('a')
    await settle()
    resource[operation]()
    release('discarded')
    await settle()
    expect(resource.peek('a')).toBeUndefined()
    resource.dispose()
  }
})
